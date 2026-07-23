import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebhookIntegrationModule } from './webhook-integration/webhook-integration.module';
import { AiBuilderModule } from './ai-builder/ai-builder.module';
import { GoogleSheetsModule } from './google-sheets/google-sheets.module';

import { SubscriptionModule } from './subscription/subscription.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [WebhookIntegrationModule, AiBuilderModule, SubscriptionModule, GoogleSheetsModule, WalletModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

