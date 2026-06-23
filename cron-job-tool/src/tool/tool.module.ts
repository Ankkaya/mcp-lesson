import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { JobModule } from '../job/job.module';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../ai/user.service';
import { CronJobToolService } from './cron-job-tool.service';
import { QueryUserToolService } from './query-user-tool.service';
import { SendMailToolService } from './send-mail-tool.service';
import { WebSearchToolService } from './web-search-tool.service';
import { DbUsersCrudToolService } from './db-users-crud-tool.service';
import { TimeNowToolService } from './time-now-tool.service';

@Module({
  imports: [UsersModule, forwardRef(() => JobModule)],
  providers: [
    UserService,
    CronJobToolService,
    QueryUserToolService,
    SendMailToolService,
    WebSearchToolService,
    DbUsersCrudToolService,
    TimeNowToolService,
    {
      provide: 'CHAT_MODEL',
      useFactory: (configService: ConfigService) => {
        return new ChatOpenAI({
          model: configService.get('MODEL_NAME'),
          apiKey: configService.get('OPENAI_API_KEY'),
          configuration: {
            baseURL: configService.get('OPENAI_BASE_URL'),
          },
        });
      },
      inject: [ConfigService],
    },
    {
      provide: 'QUERY_USER_TOOL',
      useFactory: (svc: QueryUserToolService) => svc.getTool(),
      inject: [QueryUserToolService],
    },
    {
      provide: 'SEND_MAIL_TOOL',
      useFactory: (svc: SendMailToolService) => svc.getTool(),
      inject: [SendMailToolService],
    },
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (svc: WebSearchToolService) => svc.getTool(),
      inject: [WebSearchToolService],
    },
    {
      provide: 'DB_USERS_CRUD_TOOL',
      useFactory: (svc: DbUsersCrudToolService) => svc.getTool(),
      inject: [DbUsersCrudToolService],
    },
    {
      provide: 'CRON_JOB_TOOL',
      useFactory: (svc: CronJobToolService) => svc.getTool(),
      inject: [CronJobToolService],
    },
    {
      provide: 'TIME_NOW_TOOL',
      useFactory: (svc: TimeNowToolService) => svc.tool,
      inject: [TimeNowToolService],
    },
  ],
  exports: [
    'CHAT_MODEL',
    'QUERY_USER_TOOL',
    'SEND_MAIL_TOOL',
    'WEB_SEARCH_TOOL',
    'DB_USERS_CRUD_TOOL',
    'CRON_JOB_TOOL',
    'TIME_NOW_TOOL',
  ],
})
export class ToolModule {}
