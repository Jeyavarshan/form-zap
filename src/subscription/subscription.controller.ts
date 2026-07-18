import { Controller, Get, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  getPlans() {
    return this.subscriptionService.getPlans();
  }

  @Post('create-order')
  createOrder(@Body('workspaceId') workspaceId: string, @Body('planId') planId: string) {
    return this.subscriptionService.createOrder(workspaceId, planId);
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
