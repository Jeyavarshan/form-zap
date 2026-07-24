import { Controller, Get, Post, Body, Headers, Query, HttpCode } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  getPlans() {
    return this.subscriptionService.getPlans();
  }

  @Get('status')
  getStatus(
    @Headers('x-workspace-id') headerWsId?: string,
    @Headers('x-workspace-public-id') headerPublicId?: string,
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = headerWsId || headerPublicId || queryWsId || queryPublicId || 'default_workspace';
    return this.subscriptionService.getStatus(wsId);
  }

  @Post('create-order')
  createOrder(
    @Body('workspaceId') bodyWsId?: string,
    @Headers('x-workspace-id') headerWsId?: string,
    @Body('planId') planId?: string,
  ) {
    const wsId = bodyWsId || headerWsId || 'default_workspace';
    return this.subscriptionService.createOrder(wsId, planId || 'spark_monthly_inr');
  }

  @Post('verify-payment')
  async verifyPayment(
    @Body('workspaceId') workspaceId: string,
    @Body('razorpay_order_id') orderId: string,
    @Body('razorpay_payment_id') paymentId: string,
    @Body('razorpay_signature') signature: string,
  ) {
    await this.subscriptionService.verifyPayment(
      workspaceId,
      orderId,
      paymentId,
      signature,
    );
    return { success: true, message: 'Payment verified and subscription activated.' };
  }

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(
    @Body() payload: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.subscriptionService.handleWebhook(payload, signature);
  }
}
