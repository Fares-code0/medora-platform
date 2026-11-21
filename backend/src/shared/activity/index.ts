/**
 * Public API — the user-facing activity feed's writer (RM M8.6).
 *
 * The recorder implementation is exported alongside the token only for
 * its two enum maps, which the users module needs at its serialization
 * boundary; every *caller* injects `ACTIVITY_RECORDER` and depends on
 * the interface.
 */
export {
  ACTIVITY_KINDS,
  ACTIVITY_RECORDER,
  type ActivityEntryInput,
  type ActivityKindWire,
  type ActivityRecorder,
} from './activity.types';
export { ActivityKernelModule } from './activity.module';
export { KIND_FROM_WIRE, KIND_TO_WIRE } from './prisma-activity.recorder';
