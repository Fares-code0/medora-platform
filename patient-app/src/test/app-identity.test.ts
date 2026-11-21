import fs from 'node:fs';
import path from 'node:path';

import { lightColors } from '@/theme/tokens';

/**
 * App identity — checklist W-01.
 *
 * A store rejects a build for an icon that is the wrong size or carries
 * an alpha channel, and it does so at submission, which is the most
 * expensive moment to find out. These assertions are the cheap version of
 * that review.
 *
 * They check the **facts** rather than the appearance. Whether the mark
 * looks right is a human judgement and a screenshot; whether it is 1024
 * square, opaque where iOS requires it, and actually the file `app.json`
 * points at, is not.
 */

const ROOT = path.resolve(__dirname, '..', '..');

interface ExpoConfig {
  readonly expo: {
    readonly name: string;
    readonly icon?: string;
    readonly plugins?: (
  | string
  | [
      string,
      {
        image?: string;
        imageWidth?: number;
        resizeMode?: string;
        backgroundColor?: string;
      },
    ]
)[];
    readonly ios?: { bundleIdentifier?: string };
    readonly android?: {
      package?: string;
      adaptiveIcon?: { foregroundImage?: string; backgroundColor?: string };
    };
  };
}

const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')) as ExpoConfig;
const splashPlugin = app.expo.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
);

const splashOptions = Array.isArray(splashPlugin) ? splashPlugin[1] : undefined;
/**
 * The PNG header, read by hand.
 *
 * A PNG's IHDR is the first chunk and always at the same offset, so
 * width, height and colour type are eight bytes at 16, 20 and 25. That
 * is the whole of what these tests need to know, and it is cheaper than
 * an image dependency — which `docs/ARCHITECTURE.md`'s dependency rule
 * would want a reason for, and "to read three integers" is not one.
 */
function readPng(relative: string) {
  const file = path.join(ROOT, relative.replace(/^\.\//, ''));
  const buffer = fs.readFileSync(file);

  const signature = buffer.subarray(0, 8).toString('hex');
  const COLOUR_TYPES: Record<number, string> = {
    0: 'greyscale',
    2: 'rgb',
    3: 'palette',
    4: 'greyscale+alpha',
    6: 'rgba',
  };

  return {
    file,
    isPng: signature === '89504e470d0a1a0a',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colourType: COLOUR_TYPES[buffer[25] ?? -1] ?? 'unknown',
    bytes: buffer,
  };
}

describe('the three images exist and are the ones app.json names', () => {
  it('declares an icon, an adaptive foreground and a splash mark', () => {
    // A missing declaration is how an Expo build silently ships the
    // default blank icon.
    expect(app.expo.icon).toBe('./assets/icon.png');
    expect(app.expo.android?.adaptiveIcon?.foregroundImage).toBe('./assets/adaptive-icon.png');
    expect(splashOptions?.image).toBe('./assets/splash.png');
  });

  it.each([
    ['./assets/icon.png'],
    ['./assets/adaptive-icon.png'],
    ['./assets/splash.png'],
  ])('%s is a real PNG, 1024 square', (declared) => {
    const png = readPng(declared);

    expect(png.isPng).toBe(true);
    // 1024 is what App Store Connect and Play Console take, and every
    // smaller size is derived from it. A non-square icon is a rejection.
    expect(png.width).toBe(1024);
    expect(png.height).toBe(1024);
  });
});

describe('what the stores refuse', () => {
  it('the iOS icon has no alpha channel at all', () => {
    // App Store Connect rejects an icon with an alpha channel, and it
    // rejects it for HAVING the channel, not for using it — a fully
    // opaque RGBA icon is refused too. So the generator composites the
    // mark onto the brand colour and writes colour type 2.
    //
    // Asserted from the IHDR rather than by decoding: the byte at offset
    // 25 is the colour type, which is the whole question.
    expect(readPng('./assets/icon.png').colourType).toBe('rgb');
  });

  it('the adaptive foreground is transparent, so the mask can crop it', () => {
    // Android composites the foreground over `backgroundColor` and then
    // applies a launcher-chosen mask. A foreground with its own opaque
    // background would show as a square inside the circle.
    expect(readPng('./assets/adaptive-icon.png').colourType).toBe('rgba');
  });
});

describe('branding is consistent across the two platforms', () => {
  it('paints both the splash and the adaptive background in the brand colour', () => {
    // `#2c5282` is `--color-primary` in `frontend/src/styles/tokens.css`,
    // ported into `theme/tokens.ts` by C-01. Hard-coding it in app.json
    // is unavoidable — a manifest cannot import a token — so this is
    // what stops the two drifting apart.
    expect(splashOptions?.backgroundColor).toBe(lightColors.primary);
    expect(app.expo.android?.adaptiveIcon?.backgroundColor).toBe(lightColors.primary);
  });

  it('ships one name and one identifier on both platforms', () => {
    expect(app.expo.name).toBe('Medora');
    expect(app.expo.ios?.bundleIdentifier).toBe('com.medora.patient');
    expect(app.expo.android?.package).toBe('com.medora.patient');
  });

  it('contains the splash rather than cropping it', () => {
    // `cover` would crop the mark on a tall device. `contain` is why the
    // generator can pick one size and trust it.
    expect(splashOptions?.resizeMode).toBe('contain');
  });
});
