import { useId } from 'react';

import { Activity, CalendarCheck, ShieldCheck, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useT } from '@/i18n';
import { Logo } from '@/shared/components/branding';
import { cn } from '@/utils/cn';


import './BrandPanel.css';

/**
 * Brand panel — the marketing/trust column shown on lg+ screens.
 *
 * A fixed dark canvas in both themes rather than a themed `bg-primary` slab;
 * BrandPanel.css carries the reasoning and the values. The column it used to
 * leave empty between the wordmark and the copy now holds the anatomical line
 * study below.
 */

const BENEFITS: {
  icon: LucideIcon;
  key: 'brand.benefit.records' | 'brand.benefit.scheduling' | 'brand.benefit.ai';
}[] = [
  { icon: Activity, key: 'brand.benefit.records' },
  { icon: CalendarCheck, key: 'brand.benefit.scheduling' },
  { icon: Sparkles, key: 'brand.benefit.ai' },
];

/**
 * Decorative anatomical bust — head, shoulders, thorax, and the heart marked
 * where it actually sits — over two registration rings. Square viewBox, fitted
 * rather than cropped, so it stays centred and whole in the band BrandPanel.css
 * gives it; below the ribcage it dissolves into the canvas through `fade`
 * instead of ending on the panel edge.
 *
 * The figure is one mirrored half: symmetry is what makes it read as anatomy
 * rather than as a drawing of a person, and a mirrored `<use>` cannot drift
 * from its original the way two hand-authored halves would.
 */
function BrandArt() {
  const uid = useId().replace(/:/g, '');
  const half = `ab-half-${uid}`;
  const ribs = `ab-ribs-${uid}`;
  const fade = `ab-fade-${uid}`;
  const fadeMask = `ab-fade-mask-${uid}`;
  const scan = `ab-scan-${uid}`;

  return (
    <svg
      className="auth-brand__art"
      viewBox="0 0 480 480"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Right half of the figure: neck, the trapezius running into the
            deltoid and upper arm, and the torso side from armpit to waist. */}
        <g id={half}>
          <path d="M257 131C259 147 261 157 266 168" />
          <path d="M262 168C288 176 312 188 328 206C342 222 350 242 352 266C354 300 350 334 344 368" />
          <path d="M318 214C324 248 326 284 324 316C322 348 316 378 310 406" />
        </g>

        {/* Right half of the thorax: clavicle, five ribs, costal margin. */}
        <g id={ribs}>
          <path d="M240 198C266 189 286 189 300 197" />
          <path d="M240 224C266 218 290 224 298 244" />
          <path d="M240 250C270 244 296 250 306 272" />
          <path d="M240 276C272 270 300 277 308 300" />
          <path d="M240 302C270 298 294 305 300 328" />
          <path d="M240 326C264 324 284 331 288 350" />
          <path d="M288 352C270 340 258 338 240 344" />
        </g>

        {/* The study dissolves into the canvas below the ribcage rather than
            ending on a cut edge. */}
        <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.74" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={fadeMask} maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="480">
          <rect x="0" y="0" width="480" height="480" fill={`url(#${fade})`} />
        </mask>

        <linearGradient id={scan} x1="0" y1="0" x2="0" y2="1">
          <stop className="auth-brand__scan-stop" offset="0" stopOpacity="0" />
          <stop className="auth-brand__scan-stop" offset="0.5" stopOpacity="0.2" />
          <stop className="auth-brand__scan-stop" offset="1" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g mask={`url(#${fadeMask})`}>
        <g className="auth-brand__rings">
          <circle cx="240" cy="268" r="98" />
          <circle cx="240" cy="268" r="156" />
        </g>

        <g className="auth-brand__body">
          <path d="M240 52C262 52 275 69 275 92C275 106 271 117 264 126C258 132 251 135 240 135C229 135 222 132 216 126C209 117 205 106 205 92C205 69 218 52 240 52Z" />
          <use href={`#${half}`} />
          <use href={`#${half}`} transform="translate(480 0) scale(-1 1)" />
        </g>

        <g className="auth-brand__ribs">
          <path d="M240 200V344" />
          <use href={`#${ribs}`} />
          <use href={`#${ribs}`} transform="translate(480 0) scale(-1 1)" />
        </g>

        {/* Left of the sternum, which is where a heart is. */}
        <circle className="auth-brand__heart" cx="222" cy="268" r="5.5" />
        <circle className="auth-brand__pulse" cx="222" cy="268" r="15" opacity="0.55" />
        <circle className="auth-brand__pulse" cx="222" cy="268" r="26" opacity="0.26" />
      </g>

      <rect
        className="auth-brand__scan"
        x="0"
        y="-140"
        width="480"
        height="140"
        fill={`url(#${scan})`}
      />
    </svg>
  );
}

/** One ECG complex, holding the band the copy leaves empty near the foot. */
function BrandTrace() {
  return (
    <svg
      className="auth-brand__trace"
      viewBox="0 0 480 48"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path className="auth-brand__ecg" d="M0 24H140l10-4 8 12 9-34 9 45 8-22 9 3H480" />
    </svg>
  );
}

export interface BrandPanelProps {
  className?: string | undefined;
}

export function BrandPanel({ className }: BrandPanelProps) {
  const t = useT();
  return (
    <aside
      className={cn(
        'auth-brand relative isolate flex flex-col justify-between overflow-hidden p-10 xl:p-14',
        className,
      )}
    >
      <BrandArt />
      <BrandTrace />

      {/* Inherits the panel's own ink rather than pinning `color="light"` or
          `text-text-inverse`: both of those flip with the theme, and this
          canvas deliberately does not. */}
      <div className="relative">
        <Logo size="lg" label="Medora" />
      </div>

      <div className="relative max-w-md">
        <h2 className="text-h1 font-semibold">{t('brand.welcome')}</h2>
        <p className="auth-brand__lede mt-3 text-body">{t('brand.tagline')}</p>

        <ul className="mt-8 flex flex-col gap-4">
          {BENEFITS.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3">
              <span className="auth-brand__chip mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <span className="auth-brand__benefit text-body-sm">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="auth-brand__seal relative flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
        <span className="text-caption font-medium">{t('brand.security')}</span>
      </div>
    </aside>
  );
}
