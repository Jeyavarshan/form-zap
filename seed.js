const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const plansData = [
    { name: 'free', maxFlows: 3, maxResponses: 200, aiCredits: 3, maxApiKeys: 0, hasGoogleSheets: false, hasAdvancedFlow: false, hasWhiteLabel: false, prices: { INR: { monthly: 0, quarterly: 0 }, USD: { monthly: 0, quarterly: 0 }, AED: { monthly: 0, quarterly: 0 } } },
    { name: 'spark', maxFlows: 20, maxResponses: 2000, aiCredits: 30, maxApiKeys: 1, hasGoogleSheets: true, hasAdvancedFlow: false, hasWhiteLabel: false, prices: { INR: { monthly: 299, quarterly: 809 }, USD: { monthly: 4, quarterly: 11 }, AED: { monthly: 15, quarterly: 42 } } },
    { name: 'grow', maxFlows: 50, maxResponses: 10000, aiCredits: 150, maxApiKeys: 3, hasGoogleSheets: true, hasAdvancedFlow: true, hasWhiteLabel: false, prices: { INR: { monthly: 499, quarterly: 1349 }, USD: { monthly: 6, quarterly: 17 }, AED: { monthly: 24, quarterly: 66 } } },
    { name: 'orbit', maxFlows: 99999, maxResponses: 50000, aiCredits: 500, maxApiKeys: 99999, hasGoogleSheets: true, hasAdvancedFlow: true, hasWhiteLabel: true, prices: { INR: { monthly: 799, quarterly: 2159 }, USD: { monthly: 10, quarterly: 27 }, AED: { monthly: 38, quarterly: 102 } } },
  ];

  const plans = [];
  const currencies = ['INR', 'USD', 'AED'];
  const intervals = ['MONTHLY', 'QUARTERLY'];

  for (const pd of plansData) {
    for (const currency of currencies) {
      for (const interval of intervals) {
        const intervalKey = interval.toLowerCase();
        const amount = pd.prices[currency][intervalKey];
        plans.push({
          name: `${pd.name}_${intervalKey}_${currency.toLowerCase()}`,
          amount,
          interval,
          currency,
          maxFlows: pd.maxFlows,
          maxResponses: pd.maxResponses,
          aiCredits: pd.aiCredits,
          maxApiKeys: pd.maxApiKeys,
          hasGoogleSheets: pd.hasGoogleSheets,
          hasAdvancedFlow: pd.hasAdvancedFlow,
          hasWhiteLabel: pd.hasWhiteLabel,
        });
      }
    }
  }

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: plan,
      create: {
        id: plan.name,
        name: plan.name,
        amount: plan.amount,
        currency: plan.currency,
        interval: plan.interval,
        maxFlows: plan.maxFlows,
        maxResponses: plan.maxResponses,
        aiCredits: plan.aiCredits,
        maxApiKeys: plan.maxApiKeys,
        hasGoogleSheets: plan.hasGoogleSheets,
        hasAdvancedFlow: plan.hasAdvancedFlow,
        hasWhiteLabel: plan.hasWhiteLabel,
      },
    });
  }

  await prisma.workspace.upsert({
    where: { publicId: 'workspace_poc' },
    update: { planName: 'free_monthly_inr' },
    create: {
      id: 'workspace_poc',
      publicId: 'workspace_poc',
      name: 'Default Workspace',
      planName: 'free_monthly_inr',
      aiCreditsCount: 3,
    },
  });

  const existingGrant = await prisma.walletTransaction.findFirst({
    where: { workspaceId: 'workspace_poc', type: 'plan_grant' },
  });

  if (!existingGrant) {
    await prisma.walletTransaction.create({
      data: {
        workspaceId: 'workspace_poc',
        type: 'plan_grant',
        amount: 3,
        metadata: { isLifetime: true },
      },
    });
  }

  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
