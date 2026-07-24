import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    let retries = 10;
    while (retries > 0) {
      try {
        await this.$connect();
        console.log('Successfully connected to the database');
        break;
      } catch (error: any) {
        console.error(
          `Database connection failed (Retries left: ${retries - 1}): ${error?.message || error}`,
        );
        retries -= 1;
        if (retries === 0) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
