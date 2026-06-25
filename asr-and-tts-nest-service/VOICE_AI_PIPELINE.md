# 语音输入 · 大模型流式回答 · 流式音频播放 实现说明

本文档梳理 `asr-and-tts-nest-service` 项目中"语音输入 → 大模型流式文本 → 流式音频播放"三条链路的完整实现过程，包括前后端交互协议、关键代码位置和已知问题。

---

## 一、技术栈

| 能力 | 选型 | 作用 |
|---|---|---|
| 后端框架 | NestJS 11（Express） | REST + SSE |
| 大模型 SDK | `@langchain/openai`、`@langchain/core` | 流式调用 OpenAI 兼容接口 |
| ASR / TTS | `tencentcloud-sdk-nodejs` + 原生 `ws` | 腾讯云一句话识别（HTTP）+ 流式语音合成（WebSocket） |
| 事件总线 | `@nestjs/event-emitter` | AI 模块与 TTS 中转解耦 |
| 静态资源 | `@nestjs/serve-static` | 托管 `public/` 测试页 |
| 前端播放 | `MediaSource Extensions` | 流式追加播放 MP3 分片 |

---

## 二、模块结构

```
src/
├── main.ts                         ← 在 HTTP server 上挂载原生 ws：/speech/tts/ws
├── app.module.ts                   ← 根模块：AiModule / SpeechModule / ConfigModule(全局) /
│                                      ServeStaticModule / EventEmitterModule
├── common/stream-events.ts         ← AI→TTS 事件名 + 联合类型
├── ai/
│   ├── ai.module.ts                ← 提供 AiService 和 'CHAT_MODEL' (ChatOpenAI) 工厂
│   ├── ai.controller.ts            ← @Sse('chat/stream')，SSE 入口
│   └── ai.service.ts               ← LangChain 链 + 事件 emit
└── speech/
    ├── speech.module.ts            ← 提供 SpeechService / TtsRelayService / 'ASR_CLIENT'
    ├── speech.controller.ts         ← POST /speech/asr
    ├── speech.service.ts            ← 调腾讯 SentenceRecognition
    └── tts-relay.service.ts         ← 浏览器 WS ↔ 腾讯 TTS WS 中转，@OnEvent 处理
public/
├── asr.html                        ← 仅 ASR 测试页
└── asr-ai-stream.html              ← 完整 Demo：ASR + AI SSE + TTS WS 播放
```

**关键架构**：AI 模块**不直接导入** `TtsRelayService`，两者通过 `EventEmitterModule` 解耦。AI 侧 emit `AI_TTS_STREAM_EVENT = 'ai.tts.stream'`，`TtsRelayService` 用 `@OnEvent` 订阅。

事件类型（`src/common/stream-events.ts`）：

```ts
export const AI_TTS_STREAM_EVENT = 'ai.tts.stream';
export type AiTtsStreamEvent =
  | { type: 'start'; sessionId: string; query: string }
  | { type: 'chunk'; sessionId: string; chunk: string }
  | { type: 'end'; sessionId: string }
  | { type: 'error'; sessionId: string; error: string };
```

---

## 三、语音输入（ASR）

ASR 采用**一次性 HTTP 上传**，而非 WebSocket 流式。使用腾讯云一句话识别 `SentenceRecognition`。

### 3.1 整体流程

```
 浏览器 MediaRecorder (ogg-opus, 250ms 分片)
   └→ 用户停止录音 → 组装 Blob
       └→ FormData('audio', 'record.ogg')
           └→ POST /speech/asr
               └→ SpeechController.recognize()        [speech.controller.ts:17]
                   └→ SpeechService.recognizeBySentence()  [speech.service.ts:17]
                       └→ base64 → asrClient.SentenceRecognition()
                           (16k_zh, SourceType:1, VoiceFormat:'ogg-opus')
               └→ { text } JSON
       └→ 填入输入框 → 自动触发 askWithQuery()
```

### 3.2 前端：录音采集

文件：`public/asr-ai-stream.html`（同时见 `public/asr.html`）

1. `getUserMedia({ audio: true })` 获取麦克风。
2. `new MediaRecorder(stream, { mimeType: 'audio/ogg;codecs=opus' })`；不支持时回退默认。
3. `mediaRecorder.start(250)`：每 250ms 触发一次 `ondataavailable`，将 `Blob` 推入 `chunks[]`。
4. 用户再次点击按钮 → `mediaRecorder.stop()`，`onstop` 中：
   ```js
   const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
   await uploadAndRecognize(blob);
   ```

### 3.3 前端：上传

```js
const formData = new FormData();
formData.append('audio', blob, 'record.ogg');
const res = await fetch('/speech/asr', { method: 'POST', body: formData });
return (await res.json()).text || '';
```

字段名 **`audio`** 是硬约束：后端 `FileInterceptor('audio')` 按字段名匹配。

### 3.4 后端：Controller

`src/speech/speech.controller.ts:15-34`

```ts
@Post('asr')
@UseInterceptors(FileInterceptor('audio'))
async recognize(@UploadedFile() file?: { buffer; originalname; mimetype; size }) {
  if (!file?.buffer?.length)
    throw new BadRequestException('请通过 FormData 的 audio 字段上传音频文件');
  return { text: await this.speechService.recognizeBySentence(file) };
}
```

### 3.5 后端：调腾讯 ASR

`src/speech/speech.service.ts:17-29`

```ts
const audioBase64 = file.buffer.toString('base64');
const result = await this.asrClient.SentenceRecognition({
  EngSerViceType: '16k_zh',     // 16k 普通话模型
  SourceType: 1,                // 1 = 直接传音频数据
  Data: audioBase64,            // base64 音频
  DataLen: file.buffer.length,  // 原始字节长度
  VoiceFormat: 'ogg-opus',      // 与前端 MediaRecorder 一致
});
return result.Result ?? '';
```

`ASR_CLIENT` 在 `speech.module.ts:14-32` 用 `useFactory` 构造，`region: 'ap-shanghai'`、`reqMethod: 'POST'`、`reqTimeout: 30`，并注入 `ConfigService` 读取 `SECRET_ID` / `SECRET_KEY`。

### 3.6 衔接到 AI

ASR 返回的文本被填入输入框并自动调用 `askWithQuery(recognized, '语音提问')`（`asr-ai-stream.html:598-606`），自然地进入第二链路。

---

## 四、大模型流式文本返回

使用 **Server-Sent Events（SSE）**，通过 NestJS `@Sse` 装饰器实现，**不是 WebSocket**。流式由 LangChain LCEL 链 + RxJS 驱动。

### 4.1 入口

`src/ai/ai.controller.ts:17-31`

```ts
@Sse('chat/stream')
chatStream(
  @Query('query') query: string,
  @Query('ttsSessionId') ttsSessionId: string,
): Observable<{ data: string }> {
  const sessionId = ttsSessionId?.trim();
  if (sessionId) {
    this.eventEmitter.emit(AI_TTS_STREAM_EVENT,
      { type: 'start', sessionId, query } as AiTtsStreamEvent);   // 先发 start，让 TTS 提前建链
  }
  return from(this.aiService.streamChain(query, sessionId))
    .pipe(map((chunk) => ({ data: chunk })));                     // 每个 chunk → 一帧 SSE
}
```

- URL：`GET /ai/chat/stream?query=...&ttsSessionId=...`（`ttsSessionId` 可选，没有则不触发 TTS）。
- `@Sse` 让 NestJS 自动设置 `Content-Type: text/event-stream`。
- `start` 事件**在流开始之前同步发出**，使 Tencent TTS WS 能和模型推理并行建链。
- 每个 `{ data: chunk }` 被序列化为 `data: <chunk>\n\n` 帧。

### 4.2 流式链

`src/ai/ai.service.ts`

```ts
constructor(@Inject('CHAT_MODEL') model: ChatOpenAI, eventEmitter: EventEmitter2) {
  const prompt = PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}');
  this.chain = prompt.pipe(model).pipe(new StringOutputParser());
}

async *streamChain(query, ttsSessionId?): AsyncGenerator<string> {
  try {
    const stream = await this.chain.stream({ query });
    for await (const chunk of stream) {
      if (ttsSessionId) {
        this.eventEmitter.emit(AI_TTS_STREAM_EVENT,
          { type: 'chunk', sessionId: ttsSessionId, chunk });
      }
      yield chunk;                                  // → SSE 一帧
    }
    if (ttsSessionId) {
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, { type: 'end', sessionId: ttsSessionId });
    }
  } catch (error) {
    if (ttsSessionId) {
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT,
        { type: 'error', sessionId: ttsSessionId, error: error.message });
    }
    throw error;
  }
}
```

- 模型配置在 `ai.module.ts:11-23`：`MODEL_NAME`（默认 `mimo-v2.5`）、`OPENAI_API_KEY`、`OPENAI_BASE_URL`。
- **每个文本 chunk 同时做两件事**：① emit 成 `chunk` 事件喂给 TTS 中转（如有 sessionId）；② yield 出去作为 SSE 帧。
- 正常结束 emit `end`；抛错 emit `error` 并继续向上抛。

### 4.3 AI → TTS 事件时序

| `type` | 何时 | 来源 |
|---|---|---|
| `start` | 收到 SSE 请求、流开始前 | `ai.controller.ts:24` |
| `chunk` | 每个 LLM 文本片段 | `ai.service.ts` 流循环 |
| `end` | LLM 流自然结束 | `ai.service.ts` |
| `error` | LLM 流抛异常 | `ai.service.ts` |

### 4.4 前端接收 SSE

`public/asr-ai-stream.html:483-518`

```js
const url = '/ai/chat/stream?query=' + encodeURIComponent(query)
          + (ttsSessionId ? '&ttsSessionId=' + encodeURIComponent(ttsSessionId) : '');
const es = new EventSource(url);
let aiResult = '';
es.onmessage = (event) => {
  aiResult += event.data || '';
  activeAssistantContentEl.textContent = aiResult;     // 实时更新回答气泡
};
es.onerror = () => {
  es.close();
  resolve(aiResult);                                    // 流结束由 Observable 完成触发
};
```

使用原生 `EventSource`；每帧 `data:` 累加到回答气泡。**结束靠 `onerror`**：流结束 NestJS 关闭 SSE 响应，浏览器侧表现为 `EventSource` 错误事件，用以 resolve Promise（行为正确但略显 hack）。

---

## 五、流式音频播放（TTS 中转）

最复杂的一环。后端用 `ws` 库在 `main.ts` 中**直接挂载** WebSocket 服务（不是 NestJS Gateway），把浏览器 WS 透传对接腾讯云流式 TTS WS。

### 5.1 WebSocket 接入

`src/main.ts:13-22`

```ts
const ttsWss = new WebSocketServer({ server, path: '/speech/tts/ws' });
ttsWss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '', 'http://localhost');
  const wantedSessionId = url.searchParams.get('sessionId') ?? undefined;
  const sessionId = ttsRelayService.registerClient(socket, wantedSessionId);
  socket.on('close', () => ttsRelayService.unregisterClient(sessionId));
});
```

- 路径固定为 `/speech/tts/ws`。
- 可选 `?sessionId=<uuid>` 恢复指定会话；否则服务端用 `randomUUID()` 生成。
- 注意：`main.ts` 通过 `app.get(TtsRelayService)` 取实例（非 DI 注入），这也是 `SpeechModule.exports` 需要导出 `TtsRelayService` 的原因。
- `socket.on('message')` **未注册**：浏览器不能向此 WS 发控制消息，协议是单向服务端→客户端。

### 5.2 会话注册

`tts-relay.service.ts:44-61`

```ts
registerClient(clientWs, wantedSessionId?): string {
  const sessionId = wantedSessionId?.trim() || randomUUID();
  if (this.sessions.has(sessionId)) this.closeSession(sessionId, 'client reconnected');
  this.sessions.set(sessionId, {
    sessionId, clientWs, ready: false, pendingChunks: [], closed: false,
  });
  this.sendClientJson(clientWs, { type: 'session', sessionId });  // 浏览器收到的第一帧
  return sessionId;
}
```

浏览器收到 `{ type:'session', sessionId }` 后保存 `ttsSessionId` 并解 Promise（`asr-ai-stream.html:448-450`）。

### 5.3 事件驱动（@OnEvent）

`tts-relay.service.ts:67-120`

```ts
@OnEvent(AI_TTS_STREAM_EVENT)
handleAiStreamEvent(event: AiTtsStreamEvent): void {
  const session = this.sessions.get(event.sessionId);
  if (!session) return;
  switch (event.type) {
    case 'start':  → ensureTencentConnection(session); 发送 {type:'tts_started'}
    case 'chunk':  → 腾讯 WS 未 ready：塞 pendingChunks 缓冲
                    ready：直接发送
    case 'end':    → flushPendingChunks()；向腾讯发 {action:'ACTION_COMPLETE'}
    case 'error':  → 发 tts_error；closeSession()
  }
}
```

### 5.4 腾讯 TTS WebSocket 连接

`tts-relay.service.ts:122-191`，`ensureTencentConnection`：

1. 校验 `secretId`/`secretKey`/`appId`，缺失则发 `tts_error` "TTS 凭证缺失..." 并返回。
2. `buildTencentTtsWsUrl(sessionId)` 生成签名 URL（见下）。
3. 监听腾讯 WS 四种事件：

| 事件 | 处理 |
|---|---|
| `open` | 仅记录日志 |
| `message` (isBinary=true) | **原始二进制 MP3 帧直接转发给浏览器 WS**（`session.clientWs.send(data, { binary:true })`） |
| `message` (JSON) `ready == 1` | 标记 `session.ready = true`；`flushPendingChunks()` 把之前缓存的首批发出去 |
| `message` (JSON) `code != 0` | 发 `tts_error`、关闭会话 |
| `message` (JSON) `final == 1` | 给浏览器发 `{ type:'tts_final' }` |
| `error` | 给浏览器发 `tts_error` |
| `close` | 清理 `session.tencentWs = undefined`、`ready = false` |

### 5.5 签名算法

`tts-relay.service.ts:247-279` `buildTencentTtsWsUrl`：

1. 组装参数：`Action=TextToStreamAudioWSv2`、`AppId`、`Codec='mp3'`、`SampleRate=16000`、`SecretId`、`SessionId`、`VoiceType`（默认 `101001`）、`Volume=5`、`Speed=0`、`Timestamp`、`Expired=now+3600`。
2. key **字典序排序**后拼成 `k1=v1&k2=v2&...`。
3. 签名串：`GETtts.cloud.tencent.com/stream_wsv2?<signStr>`（含 HTTP 方法和域名）。
4. `createHmac('sha1', secretKey).update(rawStr).digest('base64')` 得到 `signature`。
5. 返回 `wss://tts.cloud.tencent.com/stream_wsv2?...&Signature=...`。

### 5.6 缓冲与 flush

`tts-relay.service.ts:193-206`

`tts-relay.service.ts:208-221` 是**重复定义**（见第八节已知问题）。

`pendingChunks` 的存在理由：腾讯 WS `open` 后还要等它回 `{ready:1}` 才能收文本，提前发的会被丢。所以 chunk 先排队，等 `ready==1` 再 flush。

### 5.7 浏览器流式播放

`public/asr-ai-stream.html:362-403, 466-469`

使用 **MediaSource Extensions**，`audio/mpeg` + `sequence` 模式：

```js
function prepareStreamingAudio() {
  ttsMediaSource = new MediaSource();
  ttsAudioEl.src = URL.createObjectURL(ttsMediaSource);
  ttsMediaSource.addEventListener('sourceopen', () => {
    ttsSourceBuffer = ttsMediaSource.addSourceBuffer('audio/mpeg');
    ttsSourceBuffer.mode = 'sequence';
    ttsSourceBuffer.addEventListener('updateend', flushTtsBufferQueue);
  });
}
```

WS 收到 `ArrayBuffer` → 推入队列 → 逐帧 `sourceBuffer.appendBuffer` 等 `updateend` 再追下一帧 → `audio.play()`。`tts_final` 到达且队列空 → `endOfStream()`。

### 5.8 完整 TTS 数据流

```
AI SSE chunk (ai.service.ts)
  └→ emit AI_TTS_STREAM_EVENT {type:'chunk', sessionId, chunk}
      └→ TtsRelayService.handleAiStreamEvent
          ├→ 腾讯 WS 未 ready：pendingChunks 缓冲
          └→ ready：发送文本到腾讯 WS
              └→ 腾讯 WS 回 binary MP3
                  └→ clientWs.send(data, {binary:true})
                      └→ 浏览器 WS.onmessage(ArrayBuffer)
                          └→ ttsPendingBuffers → SourceBuffer.appendBuffer → play()
  └→ (end) flushPendingChunks → 发 {session_id, action:'ACTION_COMPLETE'} → 腾讯回 final==1
      └→ 浏览器收 tts_final → endOfStream()
```

---

## 六、消息协议汇总

### 6.1 HTTP / REST

| 方向 | 方法 + 路径 | Body / Query | 响应 |
|---|---|---|---|
| 浏览器→服务器 | `POST /speech/asr` | `multipart/form-data`，字段 `audio`（文件，通常 `record.ogg`） | `{ "text": "<识别文本>" }` 或 `400 BadRequest` |
| 浏览器→服务器 | `GET /ai/chat/stream` | query `query`（必填）、`ttsSessionId`（可选） | `text/event-stream`，每帧 `data: <chunk>\n\n`，流结束关闭 |
| 浏览器→服务器 | `GET /` | — | `"Hello World!"` |
| 浏览器→服务器 | `GET /asr-ai-stream.html` 等 | — | `public/` 下静态页 |

### 6.2 WebSocket：`ws(s)://host/speech/tts/ws`

**浏览器 → 服务器**：连接后**不发送任何消息**。`main.ts` 只注册了 `socket.on('close')`。所有驱动都发生在服务端（由独立的 SSE 调用触发事件 emit）。
查询参数：`?sessionId=<uuid>`（可选，恢复指定会话）。

**服务器 → 浏览器**（除二进制外均为 JSON 文本帧）：

| `type` | Payload | 触发时机 | 来源 |
|---|---|---|---|
| `session` | `{ type:'session', sessionId }` | WS 连接建立即时发送 | `tts-relay.service.ts:58` |
| `tts_started` | `{ type, sessionId, query }` | 收到 AI `start` 事件 | `tts-relay.service.ts:75-79` |
| `tts_error` | `{ type, message, code? }` | 凭证缺失 / 腾讯错误 / WS error / AI 错误 | `tts-relay.service.ts:127,166,181,113` |
| `tts_final` | `{ type:'tts_final' }` | 腾讯回 `final==1` | `tts-relay.service.ts:176` |
| `tts_closed` | `{ type, reason }` | 会话被关闭（重连、断开、销毁、错误） | `tts-relay.service.ts:232` |
| *(二进制)* | 原始 MP3 帧 | 腾讯发来二进制帧 | `tts-relay.service.ts:147` |

浏览器侧处理（`asr-ai-stream.html:444-470`）：
- `session` → 保存 `ttsSessionId`，解 Promise。
- `tts_started` → `prepareStreamingAudio()` 建 MediaSource。
- `tts_final` / `tts_closed` / `tts_error` → 标记 `ttsStreamFinal = true`，flush 队列，最终 `endOfStream()`。
- `ArrayBuffer`（二进制）→ 入 `ttsPendingBuffers` → flush → `appendBuffer` → `play()`。

---

## 七、端到端时序

```
[浏览器] 点击"语音输入" → 录音
[浏览器] 点击"停止" → Blob 组装 → POST /speech/asr
[后端]  SpeechController.recognize → SpeechService → 腾讯 ASR → { text }
[浏览器] 拿到 text → 同时：
        ① 先打开 WS /speech/tts/ws，等 {type:'session', sessionId}
        ② 发起 SSE GET /ai/chat/stream?query=...&ttsSessionId=<上面拿到的>
[后端]  AI Controller emit {type:'start'} → TtsRelayService 开腾讯 TTS WS
[后端]  AI Service stream 循环：每 chunk 同时 {type:'chunk'} emit + SSE 帧
[后端]  TtsRelayService.handleAiStreamEvent：
          chunk 暂存 pendingChunks（等腾讯 ready）→ flush → 发送文本
[后端]  腾讯 WS 回 binary MP3 → 透传给浏览器 WS
[浏览器] WS onmessage(ArrayBuffer) → MediaSource appendBuffer → 播放音频
[后端]  AI stream 结束 → emit {type:'end'} → flush + 腾讯发 ACTION_COMPLETE
[后端]  腾讯 final==1 → WS 发 {type:'tts_final'}
[浏览器] 收到 tts_final → MediaSource.endOfStream()
```

---

## 八、已知问题与待办

### 关键 Bug

1. **`sendTencentChunk` 方法缺失（TTS 实际无法工作）**
   `tts-relay.service.ts:93` 和 `193-221` 调用了 `this.sendTencentChunk(session, chunk)`，但类中**从未定义**该方法。腾讯 WS 一旦 ready 即抛 `TypeError`，导致无音频输出。需补一个向腾讯 WS 发送文本帧的方法（如 `{ session_id, action:'ACTION_TEXT', data: chunk }`，具体字段需对照腾讯云 WS v2 文档）。

2. **腾讯云凭据缺失（`.env` 中未配置）**
   `.env` 中没有 `SECRET_ID` / `SECRET_KEY` / `APP_ID` / `TTS_VOICE_TYPE`，导致 ASR 调用鉴权失败，TTS 直接走入"凭证缺失"分支。需在 `.env` 补齐并创建 `.env.example` 模板。

### 中等问题

3. **`flushPendingChunks` 重复定义**（`tts-relay.service.ts:193-221`）：方法体完全相同出现两次，应删除其一。

4. **无 `.env.example`**：当前 `.env` 含真实密钥且疑似未忽略版本控制，应创建 `.env.example` 并确认 `.gitignore` 包含 `.env`。

### 设计约束（非 bug，但需在文档中说明）

5. **WebSocket 非双向**：`main.ts` 只注册 `socket.on('close')`，浏览器无法发控制消息（停止/暂停/换音色）。

6. **SSE 完成靠 `onerror`**：前端用 `EventSource.onerror` 判断流结束，无显式终止事件。建议引入约定的结束帧或显式 `[DONE]` 标记。

7. **ASR `VoiceFormat` 硬编码 `ogg-opus`**：与前端 `MediaRecorder` 必须保持一致；浏览器回退 `webm` 时 ASR 会失败或乱码。

8. **TTS WebSocket 非 NestJS Gateway**：用 `ws` 库在 `main.ts` 挂载，`TtsRelayService` 通过 `app.get()` 取实例而非 DI 注入；这是导出 `TtsRelayService` 的原因，也是一种有意为之的简化。

---

## 九、环境变量清单

代码中实际读取的变量：

| 变量 | 读取位置 | 默认值 | 是否就绪 |
|---|---|---|---|
| `OPENAI_API_KEY` | `ai.module.ts:18` | — | 是 |
| `OPENAI_BASE_URL` | `ai.module.ts:18` | — | 是 |
| `MODEL_NAME` | `ai.module.ts:15` | — | 是 |
| `SECRET_ID` | `speech.module.ts:19`、`tts-relay.service.ts:30` | — | 否 |
| `SECRET_KEY` | `speech.module.ts:20`、`tts-relay.service.ts:31` | — | 否 |
| `APP_ID` | `tts-relay.service.ts:32` | — | 否 |
| `TTS_VOICE_TYPE` | `tts-relay.service.ts:34` | `101001` | 否 |
| `PORT` | `main.ts:25` | `3000` | 否 |

`.env` 中尚有 `MAIL_*`、`BOCHA_API_KEY`、`DB_*` 等变量未被本项目代码读取。