import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ToolModule } from '../tool/tool.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [ToolModule, UsersModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
