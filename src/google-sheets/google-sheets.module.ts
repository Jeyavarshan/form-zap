import { Module } from '@nestjs/common';
import { GoogleSheetsController } from './google-sheets.controller';
import { GoogleSheetsService } from './google-sheets.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [GoogleSheetsController],
  providers: [GoogleSheetsService, PrismaService],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
