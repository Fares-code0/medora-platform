/**
 * Generates the app icons from the Medora brand mark — checklist W-01.
 *
 * ── Why the icons are generated rather than committed by hand ────────
 *
 * The mark already exists, once, as vector geometry: `frontend/public/
 * favicon.svg` is the same logo `frontend/src/shared/components/branding/`
 * renders in the doctor and admin app. Hand-exporting a PNG from it would
 * make a second, unversioned copy of the brand that drifts the first time
 * someone adjusts the original — and "consistent with Medora branding on
 * both platforms" is exactly the thing that drift breaks.
 *
 * So this reads the vector and rasterises it. Re-run it after any change
 * to the mark and the three PNGs are regenerated from the one source:
 *
 *     node scripts/generate-app-icons.mjs
 *
 * `app-identity.test.ts` asserts the outputs exist, are square, are the
 * size the stores require, and are the ones `app.json` points at.
 *
 * ── Why it can rasterise an SVG without a rasteriser ─────────────────
 *
 * Because this particular path is not a general SVG path. It is a single
 * closed polygon: one `M`, 183 implicit `L`s and a `Z`, with no curves
 * and no subpaths. A scanline even-odd fill (which is what the source
 * declares, `fill-rule="evenodd"`) is therefore exact rather than an
 * approximation, and 4× supersampling is enough for clean edges at 1024.
 *
 * That is why there is no image dependency here. `pngjs` is already in
 * the tree as a transitive dependency and is only used to write the file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SOURCE_SVG = path.resolve(ROOT, '..', 'frontend', 'public', 'favicon.svg');
const OUT_DIR = path.join(ROOT, 'assets');

/** `tokens.css` `--color-primary`, and `app.json`'s adaptive-icon background. */
const BRAND = { r: 0x2c, g: 0x52, b: 0x82 };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

/** Edge quality. 4× in each axis is 16 samples per output pixel. */
const SUPERSAMPLE = 4;

function readPolygon(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const match = /\sd="([^"]+)"/.exec(svg);
  if (match === null) throw new Error(`no path data in ${file}`);

  const numbers = match[1]
    .replace(/[MZmz]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number);

  if (numbers.length % 2 !== 0 || numbers.some(Number.isNaN)) {
    throw new Error('the mark is no longer a plain polygon — this script cannot rasterise it');
  }

  const points = [];
  for (let i = 0; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  return points;
}

/**
 * An alpha mask of the polygon, scaled to occupy `coverage` of `size` and
 * centred. Even-odd fill, supersampled.
 */
function rasterise(points, size, coverage) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Fit the mark's own bounding box, not the viewBox: the viewBox has
  // padding the icon grid should not inherit.
  const scale = (size * coverage) / Math.max(maxX - minX, maxY - minY);
  const offsetX = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (size - (maxY - minY) * scale) / 2 - minY * scale;

  const placed = points.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY]);

  const samples = size * SUPERSAMPLE;
  const coverageCount = new Uint8Array(size * size);

  for (let sy = 0; sy < samples; sy += 1) {
    const y = (sy + 0.5) / SUPERSAMPLE;

    // Every edge this scanline crosses, as an x. Sorted, they pair up
    // into inside-spans — that is the even-odd rule.
    const crossings = [];
    for (let i = 0; i < placed.length; i += 1) {
      const [x1, y1] = placed[i];
      const [x2, y2] = placed[(i + 1) % placed.length];
      if (y1 === y2) continue;
      if (y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
      crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);

    const row = Math.floor(sy / SUPERSAMPLE) * size;
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const from = crossings[pair];
      const to = crossings[pair + 1];
      const firstSample = Math.max(0, Math.ceil(from * SUPERSAMPLE - 0.5));
      const lastSample = Math.min(samples - 1, Math.floor(to * SUPERSAMPLE - 0.5));
      for (let sx = firstSample; sx <= lastSample; sx += 1) {
        coverageCount[row + Math.floor(sx / SUPERSAMPLE)] += 1;
      }
    }
  }

  const perPixel = SUPERSAMPLE * SUPERSAMPLE;
  const alpha = new Uint8Array(size * size);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = Math.round((Math.min(coverageCount[i], perPixel) / perPixel) * 255);
  }
  return alpha;
}

/**
 * @param background `null` for transparent. **iOS refuses an app icon
 *   with an alpha channel**, so `icon.png` is the one that must not be.
 */
function write(file, size, coverage, points, background, mark) {
  const alpha = rasterise(points, size, coverage);
  const png = new PNG({ width: size, height: size });

  for (let i = 0; i < size * size; i += 1) {
    const a = alpha[i] / 255;
    const at = i * 4;
    if (background === null) {
      png.data[at] = mark.r;
      png.data[at + 1] = mark.g;
      png.data[at + 2] = mark.b;
      png.data[at + 3] = alpha[i];
    } else {
      png.data[at] = Math.round(background.r * (1 - a) + mark.r * a);
      png.data[at + 1] = Math.round(background.g * (1 - a) + mark.g * a);
      png.data[at + 2] = Math.round(background.b * (1 - a) + mark.b * a);
      png.data[at + 3] = 255;
    }
  }

  // An opaque image is written as colour type 2 — RGB, with no alpha
  // CHANNEL at all, not merely an alpha channel that happens to be 255.
  // That is what App Store Connect checks, and it is readable straight
  // out of the IHDR, so `app-identity.test.ts` can assert it without
  // decoding the file.
  fs.writeFileSync(file, PNG.sync.write(png, background === null ? {} : { colorType: 2 }));
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  ${path.relative(ROOT, file)}  ${size}×${size}  ${kb} kB`);
}

const points = readPolygon(SOURCE_SVG);
fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`Medora app icons, from ${path.relative(path.resolve(ROOT, '..'), SOURCE_SVG)}:`);

// The store icon. Opaque, because iOS rejects an alpha channel, and
// 1024 because that is what App Store Connect and Play Console take.
write(path.join(OUT_DIR, 'icon.png'), 1024, 0.62, points, BRAND, WHITE);

// Android's adaptive foreground. Transparent — `app.json` supplies the
// background colour — and small enough to survive every mask shape: the
// launcher may crop to a circle, and only the inner 66% is guaranteed.
write(path.join(OUT_DIR, 'adaptive-icon.png'), 1024, 0.44, points, null, WHITE);

// The splash mark. Transparent over `splash.backgroundColor`, and
// smaller again: a splash logo that fills the screen reads as an error.
write(path.join(OUT_DIR, 'splash.png'), 1024, 0.5, points, null, WHITE);
