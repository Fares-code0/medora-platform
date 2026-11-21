import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database';

import { ACTIVITY_RECORDER } from './activity.types';
import { PrismaActivityRecorder } from './prisma-activity.recorder';

/**
 * Binds `ACTIVITY_RECORDER` to the Prisma writer (RM M8.6).
 *
 * Imports `DatabaseModule` explicitly rather than relying on the shared
 * kernel being `@Global`: the kernel's own members are assembled before
 * the global registration takes effect for them, and a kernel module
 * that depends on another must say so.
 */
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: ACTIVITY_RECORDER, useClass: PrismaActivityRecorder }],
  exports: [ACTIVITY_RECORDER],
})
export class ActivityKernelModule {}
