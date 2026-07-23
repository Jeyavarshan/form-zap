import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlanLimitsGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<string>('plan_limit', context.getHandler());
    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const workspaceId = request.headers['x-workspace-id'] || request.body?.workspaceId || request.query?.workspaceId;
    const workspacePublicId = request.headers['x-workspace-public-id'] || request.body?.workspacePublicId || request.query?.workspacePublicId;

    if (!workspaceId && !workspacePublicId) {
      throw new ForbiddenException('Workspace ID or Public ID is required for this action');
    }

    const includeOptions = {
      subscriptions: {
        where: { status: 'ACTIVE' },
        include: { plan: true },
        orderBy: { createdAt: 'desc' as const },
        take: 1
      }
    };

    let workspace;
    if (workspaceId) {
      workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: includeOptions
      });
    } else {
      workspace = await this.prisma.workspace.findUnique({
        where: { publicId: workspacePublicId },
        include: includeOptions
      });
    }

    if (!workspace) {
      throw new ForbiddenException('Workspace not found');
    }

    // Default to Free plan limits if no active subscription
    const plan = workspace.subscriptions.length > 0 
      ? workspace.subscriptions[0].plan 
      : { 
          name: 'free',
          maxFlows: 3, 
          maxResponses: 200, 
          maxApiKeys: 0, 
          hasGoogleSheets: false, 
          hasAdvancedFlow: false, 
          hasWhiteLabel: false 
        };

    if (requiredFeature === 'google_sheets') {
      if (!plan.hasGoogleSheets) {
        throw new ForbiddenException({ reason: 'google_sheets_integration', message: 'Upgrade to Spark plan or higher' });
      }
    } else if (requiredFeature === 'advanced_flow') {
      if (!plan.hasAdvancedFlow) {
        throw new ForbiddenException({ reason: 'advanced_flow_components', message: 'Upgrade to Grow plan or higher' });
      }
    } else if (requiredFeature === 'active_flows_limit') {
      const activeFlowsCount = await this.prisma.formIntegration.count({ where: { workspaceId: workspace.id } });
      if (activeFlowsCount >= plan.maxFlows) {
        throw new ForbiddenException({ reason: 'active_flows_limit', message: 'Active flows limit reached' });
      }
    } else if (requiredFeature === 'api_keys_limit') {
      if (plan.maxApiKeys === 0) {
        throw new ForbiddenException({ reason: 'api_keys_limit', message: 'Upgrade to Spark plan to create API keys' });
      }
    } else if (requiredFeature === 'white_label') {
      if (!plan.hasWhiteLabel) {
        throw new ForbiddenException({ reason: 'white_label', message: 'Upgrade to Orbit plan' });
      }
    } else if (requiredFeature === 'ai_topup_not_allowed') {
       if (plan.name.startsWith('free') || plan.name.startsWith('spark')) {
         throw new ForbiddenException({ reason: 'ai_topup_not_allowed', message: 'Upgrade to Grow plan or higher to buy AI credits' });
       }
    }

    return true;
  }
}
