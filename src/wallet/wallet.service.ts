import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly USD_TO_INR = 84;
  private readonly INPUT_COST_PER_K_TOKEN = 0.000075;
  private readonly OUTPUT_COST_PER_K_TOKEN = 0.0003;
  private readonly INR_PER_CREDIT = 6;
  private readonly MAX_CREDITS_PER_GEN = 5;

  constructor(private readonly prisma: PrismaService) {}

  async ensureWorkspace(workspaceIdOrPublicId?: string) {
    const rawId = (workspaceIdOrPublicId || '').trim() || 'default_workspace';

    let workspace = await this.prisma.workspace.findFirst({
      where: {
        OR: [{ id: rawId }, { publicId: rawId }],
      },
      include: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!workspace) {
      workspace = await this.prisma.workspace.create({
        data: {
          id: rawId,
          publicId: rawId,
          name: `Workspace ${rawId}`,
          planName: 'free_monthly_inr',
          aiCreditsCount: 3,
        },
        include: {
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      await this.prisma.walletTransaction.create({
        data: {
          workspaceId: workspace.id,
          type: 'plan_grant',
          amount: 3,
          metadata: { isLifetime: true, reason: 'auto_provisioned' },
        },
      });
    }

    return workspace;
  }

  async getBalance(workspaceId: string) {
    const workspace = await this.ensureWorkspace(workspaceId);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { workspaceId: workspace.id },
    });

    let planCredits = 0;
    let topupCredits = 0;

    for (const tx of transactions) {
      if (tx.type === 'plan_grant') planCredits += tx.amount;
      else if (tx.type === 'expire') planCredits += tx.amount; // amount is negative
      else if (tx.type === 'topup') topupCredits += tx.amount;
      else if (tx.type === 'consume' || tx.type === 'refund') {
        const meta = tx.metadata as any;
        if (meta?.planConsumed) planCredits -= meta.planConsumed;
        if (meta?.topupConsumed) topupCredits -= meta.topupConsumed;
      }
    }

    return {
      planCreditsRemaining: Math.max(0, planCredits),
      purchasedCreditsBalance: Math.max(0, topupCredits),
      totalBalance: Math.max(0, planCredits) + Math.max(0, topupCredits),
    };
  }

  async deductCredits(workspaceId: string, inputTokens: number, outputTokens: number, metadata: any = {}) {
    const workspace = await this.ensureWorkspace(workspaceId);
    
    // Ensure initial plan credits are granted if first time
    await this.refreshPlanCreditsIfNeeded(workspace.id);

    // 1. Calculate cost - default to 1 credit if tokens not provided
    let creditsToCharge = 1;

    if (inputTokens > 0 || outputTokens > 0) {
      const costInr = ((inputTokens / 1000) * this.INPUT_COST_PER_K_TOKEN + (outputTokens / 1000) * this.OUTPUT_COST_PER_K_TOKEN) * this.USD_TO_INR;
      creditsToCharge = Math.ceil(costInr / this.INR_PER_CREDIT);
      creditsToCharge = Math.min(creditsToCharge, this.MAX_CREDITS_PER_GEN);
    }
    
    creditsToCharge = Math.max(1, creditsToCharge);

    // 2. Check balance
    const balance = await this.getBalance(workspace.id);
    if (balance.totalBalance < creditsToCharge) {
      throw new BadRequestException('ai_credits_exhausted');
    }

    // 3. Deduct from plan first, then topup
    let planConsumed = 0;
    let topupConsumed = 0;

    if (balance.planCreditsRemaining >= creditsToCharge) {
      planConsumed = creditsToCharge;
    } else {
      planConsumed = balance.planCreditsRemaining;
      topupConsumed = creditsToCharge - planConsumed;
    }

    // 4. Create transaction
    const tx = await this.prisma.walletTransaction.create({
      data: {
        workspaceId: workspace.id,
        type: 'consume',
        amount: -creditsToCharge,
        metadata: {
          ...metadata,
          planConsumed,
          topupConsumed,
          inputTokens,
          outputTokens
        }
      }
    });

    // Update workspace cache
    await this.updateWorkspaceCache(workspace.id, balance.totalBalance - creditsToCharge);

    return {
      charged: creditsToCharge,
      transactionId: tx.id,
      newBalance: balance.totalBalance - creditsToCharge
    };
  }

  async refreshPlanCreditsIfNeeded(workspaceId: string) {
    const workspace = await this.ensureWorkspace(workspaceId);

    let monthlyCreditsAllowed = 3; // Default free lifetime
    let isLifetime = true;
    
    if (workspace.subscriptions.length > 0) {
      monthlyCreditsAllowed = workspace.subscriptions[0].plan.aiCredits;
      isLifetime = false;
    }

    // Find the last plan_grant transaction
    const lastGrant = await this.prisma.walletTransaction.findFirst({
      where: { workspaceId, type: 'plan_grant' },
      orderBy: { createdAt: 'desc' }
    });

    const now = new Date();
    
    if (!lastGrant) {
      // First time grant
      await this.grantPlanCredits(workspaceId, monthlyCreditsAllowed, isLifetime);
      return;
    }

    if (!isLifetime) {
      const grantDate = new Date(lastGrant.createdAt);
      // Check if it's a new calendar month
      if (grantDate.getMonth() !== now.getMonth() || grantDate.getFullYear() !== now.getFullYear()) {
        // Expire unused plan credits
        const balance = await this.getBalance(workspaceId);
        if (balance.planCreditsRemaining > 0) {
          await this.prisma.walletTransaction.create({
            data: {
              workspaceId,
              type: 'expire',
              amount: -balance.planCreditsRemaining,
              metadata: { reason: 'monthly_rollover' }
            }
          });
        }
        
        // Grant new credits
        await this.grantPlanCredits(workspaceId, monthlyCreditsAllowed, false);
      }
    }
  }

  private async grantPlanCredits(workspaceId: string, amount: number, isLifetime: boolean) {
    await this.prisma.walletTransaction.create({
      data: {
        workspaceId,
        type: 'plan_grant',
        amount,
        metadata: { isLifetime }
      }
    });
    
    const bal = await this.getBalance(workspaceId);
    await this.updateWorkspaceCache(workspaceId, bal.totalBalance);
  }

  async topup(workspaceId: string, credits: number, metadata: any) {
    await this.prisma.walletTransaction.create({
      data: {
        workspaceId,
        type: 'topup',
        amount: credits,
        metadata
      }
    });
    const bal = await this.getBalance(workspaceId);
    await this.updateWorkspaceCache(workspaceId, bal.totalBalance);
  }

  private async updateWorkspaceCache(workspaceId: string, newTotal: number) {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { aiCreditsCount: newTotal }
    });
  }
}
