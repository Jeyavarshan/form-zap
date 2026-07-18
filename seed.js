const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const plans = [
    { name: 'free_monthly', amount: 0, interval: 'MONTHLY', maxFlows: 1, maxResponses: 100, aiCredits: 3 },
    { name: 'free_annual', amount: 0, interval: 'ANNUAL', maxFlows: 1, maxResponses: 100, aiCredits: 3 },
    { name: 'starter_monthly', amount: 999, interval: 'MONTHLY', maxFlows: 5, maxResponses: 1000, aiCredits: 50 },
    { name: 'starter_annual', amount: 799 * 12, interval: 'ANNUAL', maxFlows: 5, maxResponses: 1000, aiCredits: 50 },
    { name: 'growth_monthly', amount: 3499, interval: 'MONTHLY', maxFlows: 25, maxResponses: 10000, aiCredits: 300 },
    { name: 'growth_annual', amount: 2799 * 12, interval: 'ANNUAL', maxFlows: 25, maxResponses: 10000, aiCredits: 300 },
    { name: 'business_monthly', amount: 9999, interval: 'MONTHLY', maxFlows: 99999, maxResponses: 50000, aiCredits: 1000 },
    { name: 'business_annual', amount: 7999 * 12, interval: 'ANNUAL', maxFlows: 99999, maxResponses: 50000, aiCredits: 1000 },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: plan,
      create: {
        id: plan.name,
        name: plan.name,
        amount: plan.amount,
        interval: plan.interval,
        maxFlows: plan.maxFlows,
        maxResponses: plan.maxResponses,
        aiCredits: plan.aiCredits,
      },
    });
  }

  await prisma.workspace.upsert({
    where: { publicId: 'workspace_poc' },
    update: {},
    create: {
      id: 'workspace_poc',
      publicId: 'workspace_poc',
      name: 'Default Workspace',
      planName: 'Free',
    },
  });

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
