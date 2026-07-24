import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { WalletService } from '../wallet/wallet.service';

const PACKS: Record<string, { amount: number, credits: number, currency: string }> = {
  pack_30_inr: { amount: 149, credits: 30, currency: 'INR' },
  pack_30_usd: { amount: 2, credits: 30, currency: 'USD' },
  pack_100_inr: { amount: 399, credits: 100, currency: 'INR' },
  pack_100_usd: { amount: 5, credits: 100, currency: 'USD' },
  pack_250_inr: { amount: 899, credits: 250, currency: 'INR' },
  pack_250_usd: { amount: 11, credits: 250, currency: 'USD' },
};

@Injectable()
export class SubscriptionService {
  private readonly razorpay: Razorpay;
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService
  ) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      this.logger.error('Razorpay credentials not found in environment variables');
    }

    this.razorpay = new Razorpay({
      key_id: keyId || 'dummy_key',
      key_secret: keySecret || 'dummy_secret',
    });
  }

  async getPlans() {
    return this.prisma.plan.findMany({
      orderBy: { amount: 'asc' },
    });
  }

  async getStatus(workspaceId?: string) {
    const targetId = (workspaceId || '').trim() || 'default_workspace';
    const workspace = await this.walletService.ensureWorkspace(targetId);
    const wallet = await this.walletService.getBalance(workspace.id);
    
    // Usage stats
    const activeFlows = await this.prisma.formIntegration.count({ where: { workspaceId: workspace.id } });
    const monthlyResponses = await this.prisma.flowSubmission.count({ 
      where: { workspaceId: workspace.id, submittedAt: { gte: new Date(new Date().setDate(1)) } }
    });
    const apiKeys = 0;

    let planId = 'free';
    let billingCycle = 'monthly';

    if (workspace.subscriptions.length > 0) {
      const activeSub = workspace.subscriptions[0];
      const parsedPlanId = activeSub.plan.name.split('_')[0]; // e.g. "spark_monthly_inr" -> "spark"
      planId = parsedPlanId;
      billingCycle = activeSub.plan.interval.toLowerCase();
    }

    return {
      planId,
      billingCycle,
      planCreditsRemaining: wallet.planCreditsRemaining,
      purchasedCreditsBalance: wallet.purchasedCreditsBalance,
      usageStats: {
        activeFlows,
        monthlyResponses,
        apiKeys
      }
    };
  }

  async createOrder(workspaceId: string, planId: string) {
    const workspace = await this.walletService.ensureWorkspace(workspaceId);

    let billingAmount = 0;
    let currency = 'INR';
    let isPack = false;
    let interval = 'ONETIME';

    if (PACKS[planId]) {
      const pack = PACKS[planId];
      billingAmount = pack.amount;
      currency = pack.currency;
      isPack = true;
    } else {
      const plan = await this.prisma.plan.findUnique({
        where: { name: planId },
      });

      if (!plan) {
        throw new NotFoundException('Plan or pack not found');
      }

      billingAmount = plan.amount;
      currency = plan.currency;
      interval = plan.interval;
    }

    const options = {
      amount: Math.round(billingAmount * 100), // amount in the smallest currency unit
      currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        workspaceId,
        planId,
        isPack: isPack ? 'true' : 'false',
      },
    };

    try {
      const order = await this.razorpay.orders.create(options);

      await this.prisma.paymentTransaction.create({
        data: {
          workspaceId,
          amount: billingAmount,
          currency,
          razorpayOrderId: order.id,
          status: 'PENDING',
          metadata: {
            planId,
            interval,
            isPack,
          },
        },
      });

      return order;
    } catch (error: any) {
      this.logger.error(`Error creating Razorpay order: ${error?.message || error}`, error?.stack);
      throw new BadRequestException('Failed to create payment order');
    }
  }

  async verifyPayment(
    workspaceId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const generatedSignature = crypto
      .createHmac('sha256', keySecret || 'dummy_secret')
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      this.logger.warn(`Invalid signature for order ${razorpayOrderId}`);

      await this.prisma.paymentTransaction.update({
        where: { razorpayOrderId },
        data: {
          status: 'FAILED',
          errorReason: 'Invalid signature',
        },
      });

      throw new BadRequestException('Invalid payment signature');
    }

    return this.completePayment(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  }

  private async completePayment(orderId: string, paymentId: string, signature: string) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.paymentTransaction.findUnique({
        where: { razorpayOrderId: orderId },
      });

      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }

      if (transaction.status === 'SUCCESS') {
        return transaction;
      }

      const updatedTransaction = await tx.paymentTransaction.update({
        where: { razorpayOrderId: orderId },
        data: {
          status: 'SUCCESS',
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        },
      });

      const metadata = transaction.metadata as any;
      const planId = metadata.planId;
      const isPack = metadata.isPack;

      if (isPack) {
        // Handle Pack Topup
        const pack = PACKS[planId];
        await this.walletService.topup(transaction.workspaceId, pack.credits, { orderId });
      } else {
        // Handle Subscription
        const plan = await tx.plan.findUnique({
          where: { name: planId },
        });

        if (!plan) {
          throw new NotFoundException('Plan not found for transaction');
        }

        const start = new Date();
        const end = new Date();
        if (plan.interval === 'MONTHLY') {
          end.setMonth(end.getMonth() + 1);
        } else if (plan.interval === 'ANNUAL') {
          end.setFullYear(end.getFullYear() + 1);
        } else if (plan.interval === 'QUARTERLY') {
          end.setMonth(end.getMonth() + 3);
        }

        const existingSubscription = await tx.subscription.findFirst({
          where: { workspaceId: transaction.workspaceId },
          orderBy: [
            { currentPeriodEnd: 'desc' },
            { updatedAt: 'desc' },
          ],
        });

        const subscription = await tx.subscription.upsert({
          where: {
            id: existingSubscription?.id || 'none',
          },
          update: {
            planId: plan.id,
            status: 'ACTIVE',
            currentPeriodStart: start,
            currentPeriodEnd: end,
            updatedAt: new Date(),
          },
          create: {
            workspaceId: transaction.workspaceId,
            planId: plan.id,
            status: 'ACTIVE',
            currentPeriodStart: start,
            currentPeriodEnd: end,
          },
        });

        await tx.subscription.updateMany({
          where: {
            workspaceId: transaction.workspaceId,
            id: { not: subscription.id },
            status: 'ACTIVE',
          },
          data: {
            status: 'INACTIVE',
            updatedAt: new Date(),
          },
        });

        await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: { subscriptionId: subscription.id },
        });

        await tx.workspace.update({
          where: { id: transaction.workspaceId },
          data: { planName: plan.name },
        });
        
        // Grant credits for new plan
        await this.walletService.refreshPlanCreditsIfNeeded(transaction.workspaceId);
      }

      return updatedTransaction;
    });
  }

  async handleWebhook(payload: any, signature: string) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

      if (expectedSignature !== signature) {
        this.logger.warn('Invalid webhook signature');
        return { status: 'invalid_signature' };
      }
    }

    const event = payload.event;
    this.logger.log(`Handling Razorpay webhook event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const razorpayOrderId = payload.payload.payment.entity.order_id || payload.payload.order.entity.id;
      const razorpayPaymentId = payload.payload.payment.entity.id;

      await this.completePayment(razorpayOrderId, razorpayPaymentId, 'WEBHOOK_CAPTURED');
    } else if (event === 'payment.failed') {
      const razorpayOrderId = payload.payload.payment.entity.order_id;
      await this.prisma.paymentTransaction.update({
        where: { razorpayOrderId },
        data: {
          status: 'FAILED',
          errorReason: payload.payload.payment.entity.error_description,
        },
      });
    }

    return { status: 'ok' };
  }
}
