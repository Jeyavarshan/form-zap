import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebhookIntegrationModule } from './webhook-integration/webhook-integration.module';
import { AiBuilderModule } from './ai-builder/ai-builder.module';

@Module({
  imports: [WebhookIntegrationModule, AiBuilderModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

