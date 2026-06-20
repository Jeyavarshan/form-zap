import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhookIntegrationController } from './webhook-integration.controller';
import { WebhookIntegrationService } from './webhook-integration.service';
import { WebhookReceiverController } from './webhook-receiver.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WebhookIntegrationController, WebhookReceiverController],
  providers: [WebhookIntegrationService],
})
export class WebhookIntegrationModule {}
