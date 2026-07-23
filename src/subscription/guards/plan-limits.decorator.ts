import { SetMetadata } from '@nestjs/common';

export const CheckPlanLimit = (feature: string) => SetMetadata('plan_limit', feature);
