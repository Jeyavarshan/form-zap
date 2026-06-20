import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebhookIntegrationModule } from './webhook-integration/webhook-integration.module';

@Module({
  imports: [WebhookIntegrationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
