import { Controller, Get, Query, Sse } from '@nestjs/common';
import { AiService } from './ai.service';
import { Observable, from, map } from 'rxjs';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<MessageEvent> {
    const stream = this.aiService.runChainStream(query);

    return from(stream).pipe(
      map(
        (chunk) =>
          ({
            data: chunk,
          }) as MessageEvent,
      ),
    );
  }

  @Get('chat/service')
  async chatWithService(@Query('query') query: string) {
    const answer = await this.aiService.runChainWithService(query);
    return { answer };
  }

  @Sse('chat/service/stream')
  chatStreamWithService(
    @Query('query') query: string,
  ): Observable<MessageEvent> {
    const stream = this.aiService.runChainStreamWithService(query);

    return from(stream).pipe(
      map(
        (chunk) =>
          ({
            data: chunk,
          }) as MessageEvent,
      ),
    );
  }
}
