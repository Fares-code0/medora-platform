/** Public API — transactional outbox (RM M2.3, durable since M19.1). */
export {
  OUTBOX,
  type OutboxMessage,
  type OutboxPayload,
  type OutboxPort,
  type OutboxTransaction,
} from './outbox.types';
export { OutboxKernelModule } from './outbox.module';
