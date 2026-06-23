import { Inject, Injectable } from '@nestjs/common';
import { StructuredTool, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SendMailToolService {
  private readonly _tool: StructuredTool;

  constructor(
    @Inject(MailerService) private readonly mailerService: MailerService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    const sendMailArgsSchema = z.object({
      to: z.string().email().describe('收件人邮箱地址'),
      subject: z.string().describe('邮件主题'),
      text: z.string().optional().describe('邮件纯文本正文内容'),
      html: z.string().optional().describe('邮件 HTML 正文内容'),
    });

    this._tool = tool(
      async ({
        to,
        subject,
        text,
        html,
      }: {
        to: string;
        subject: string;
        text?: string;
        html?: string;
      }) => {
        try {
          await this.mailerService.sendMail({
            from: this.configService.get<string>('MAIL_FROM'),
            to,
            subject,
            text,
            html,
          });
          return `邮件已成功发送至 ${to}`;
        } catch (error) {
          return `邮件发送失败: ${error.message}`;
        }
      },
      {
        name: 'send_mail',
        description:
          '发送邮件。输入收件人邮箱、邮件主题和正文内容，发送邮件给指定收件人。text 和 html 可选，至少提供一个。',
        schema: sendMailArgsSchema,
      },
    );
  }

  getTool(): StructuredTool {
    return this._tool;
  }
}
