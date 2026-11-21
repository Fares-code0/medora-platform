/**
 * The shared kernel's root public API (RM M2.3).
 *
 * Only `app.module.ts` needs this one — it registers the kernel. Domain
 * modules import the per-kernel entry points instead
 * (`shared/audit`, `shared/outbox`, `shared/files`, `shared/status`),
 * so that what a module depends on is legible from its imports rather
 * than hidden behind one barrel that re-exports everything.
 */
export { SharedKernelModule } from './shared-kernel.module';
