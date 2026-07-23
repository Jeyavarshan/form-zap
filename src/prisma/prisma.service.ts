import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    let retries = 5;
    while (retries > 0) {
      try {
        await this.$connect();
        console.log('Successfully connected to the database');
        break;
      } catch (error) {
        console.error(`Database connection failed. Retries left: ${retries - 1}`);
        retries -= 1;
        if (retries === 0) {
          throw error;
        }
        // Wait 3 seconds before retrying to allow DB to wake up
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
