# Version History

## Latest Changes (2026-01-12)

### New Files Added

本项目新增了以下文本分块（Text Splitting）相关的测试文件：

| File | Description |
|------|-------------|
| [src/test-tiktoken.mjs](src/test-tiktoken.mjs) | 测试 js-tiktoken 库功能：获取模型编码名称、测试不同文本的 token 数量（支持中英文） |
| [src/CharacterTextSplitter-test.mjs](src/CharacterTextSplitter-test.mjs) | 测试 CharacterTextSplitter：基于字符数按换行符分割日志文本 |
| [src/RecursiveCharacterTextSplitter-test.mjs](src/RecursiveCharacterTextSplitter-test.mjs) | 测试 RecursiveCharacterTextSplitter：使用多种分隔符（`\n`、`。`、`，`）递归分块 |
| [src/TokenTextSplitter-test.mjs](src/TokenTextSplitter-test.mjs) | 测试 TokenTextSplitter：基于 token 数量（cl100k_base 编码）进行分块 |
| [src/recursive-splitter-code.mjs](src/recursive-splitter-code.mjs) | 测试 JS 代码分块：使用 RecursiveCharacterTextSplitter.fromLanguage('js') |
| [src/recursive-splitter-markdown.mjs](src/recursive-splitter-markdown.mjs) | 测试 Markdown 文档分块：使用 MarkdownTextSplitter |
| [src/recusive-splitter-latex.mjs](src/recusive-splitter-latex.mjs) | 测试 LaTeX 公式分块：使用 LatexTextSplitter |

### Dependencies Used

- `js-tiktoken` - token 计数库
- `@langchain/textsplitters` - LangChain 文本分块工具
- `@langchain/core` - LangChain 核心库
- `dotenv` - 环境变量管理
- `cheerio` - HTML 解析（依赖）

### Key Configurations

| Splitter Type | chunkSize | chunkOverlap | Separators |
|---------------|-----------|--------------|------------|
| CharacterTextSplitter | 200 | 20 | `\n` |
| RecursiveCharacterTextSplitter | 150 | 20 | `\n`, `。`, `，` |
| TokenTextSplitter | 50 | 10 | - |
| JS Code Splitter | 300 | 60 | Language-specific |
| MarkdownTextSplitter | 400 | 80 | - |
| LatexTextSplitter | 200 | 40 | - |
