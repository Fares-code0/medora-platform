import { createLucideIcon } from 'lucide-react';

/**
 * The customize control's icon: a widget card with a plus badge on its
 * top-right corner — "add a widget to this dashboard", not "edit". Drawn on
 * lucide's 24px grid with lucide's own factory, so it takes the same props
 * (`className`, `strokeWidth`, `aria-hidden`) and slots into `leadingIcon`
 * like any other icon. Every mark paints with `currentColor`, so it follows
 * the button's text colour in light and dark themes.
 *
 * The card's outline stops short of the badge on both sides (1.5px gap), so
 * the plus reads as sitting on the corner rather than being clipped by it.
 */
export const DashboardWidgetAddIcon = createLucideIcon('DashboardWidgetAdd', [
  ['path', { d: 'M13 5H6a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-6', key: 'card' }],
  [
    'rect',
    { x: '6.5', y: '8.5', width: '3.5', height: '3', rx: '1', fill: 'currentColor', key: 'tile' },
  ],
  ['path', { d: 'M7 16h7', key: 'line' }],
  ['circle', { cx: '18.5', cy: '5.5', r: '4', key: 'badge' }],
  ['path', { d: 'M18.5 3.5v4M16.5 5.5h4', key: 'plus' }],
]);
