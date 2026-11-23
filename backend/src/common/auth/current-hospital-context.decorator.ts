import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import {
  HOSPITAL_CONTEXT,
  type HospitalContext,
  type RequestWithHospitalContext,
} from './hospital-context';

/** Reads only context attached by the Phase 22 server-side shadow resolver. */
export const CurrentHospitalContext = createParamDecorator(
  (_data: unknown, executionContext: ExecutionContext): HospitalContext => {
    const request = executionContext.switchToHttp().getRequest<RequestWithHospitalContext>();
    const context = request[HOSPITAL_CONTEXT];

    if (context === undefined) {
      throw new Error(
        '@CurrentHospitalContext() used before the authenticated request context resolver ran.',
      );
    }

    return context;
  },
);
