import { Module, Global } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
