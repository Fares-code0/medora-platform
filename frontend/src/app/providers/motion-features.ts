import { domMax } from 'framer-motion';

/**
 * Framer Motion feature bundle — loaded ASYNC by MotionProvider's
 * LazyMotion (Phase 19 performance). `domMax` (animations + gestures +
 * layout projection, needed for the Tabs `layoutId` underline) ships in
 * its own chunk, keeping the heavy animation runtime out of the initial
 * bundle; the entry only carries the tiny `m`/`LazyMotion` runtime.
 */
export default domMax;
