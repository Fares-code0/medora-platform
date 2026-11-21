import fs from 'node:fs';
import path from 'node:path';

/**
 * Every native module is the version this Expo SDK ships — checklist
 * T-12, B-01.
 *
 * ── The defect this closes ───────────────────────────────────────────
 *
 * `package.json` declared **`expo-asset@^57.0.16`** and
 * **`expo-font@^57.0.3`** in a project on **Expo SDK 52**, whose own
 * `expo` package depends on `expo-asset@~11.0.5` and `expo-font@~13.0.4`.
 * Five majors out, and installed at the root — so `@expo/vector-icons`,
 * which reaches for `expo-font` in every icon this app draws, resolved
 * the SDK-57 copy while `expo` used its own nested SDK-52 one. Two
 * copies of two native modules, and autolinking would have compiled the
 * wrong one into the binary.
 *
 * Nothing caught it. It is invisible to `tsc` (no types cross), to
 * `eslint`, and to the suite (jest resolves whatever is there). `expo
 * doctor` does catch it — and needs the network, which CI here does not
 * reach for the Expo API.
 *
 * ── Why `bundledNativeModules.json` is the authority ─────────────────
 *
 * It ships *inside* the installed `expo` package: it is the SDK's own
 * statement of which version of each module that SDK was built against,
 * it is already on disk, and it changes only when the SDK does. So this
 * check needs no network and cannot drift from the SDK it is checking.
 *
 * It deliberately reads the **installed** version rather than the
 * declared range. A range is a promise; `node_modules` is what Metro
 * will bundle and what autolinking will compile.
 */

const APP = path.resolve(__dirname, '..', '..');

interface PackageJson {
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(APP, 'package.json'), 'utf8'),
) as PackageJson;

const bundled = JSON.parse(
  fs.readFileSync(path.join(APP, 'node_modules', 'expo', 'bundledNativeModules.json'), 'utf8'),
) as Record<string, string>;

function installedVersion(name: string): string | null {
  const manifest = path.join(APP, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifest)) return null;
  return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/** `1.2.3` → `[1, 2, 3]`, ignoring any pre-release suffix. */
function parts(version: string): [number, number, number] {
  const [major = '0', minor = '0', patch = '0'] = version.replace(/^[~^]/, '').split(/[.-]/);
  return [Number(major), Number(minor), Number(patch)];
}

/**
 * Enough of semver for the three forms `bundledNativeModules.json` uses:
 * `~a.b.c` (patch may move), `^a.b.c` (minor may move), and an exact pin.
 * Hand-rolled rather than pulling `semver` in, because a test that
 * guards the dependency list should not add one.
 */
function satisfies(version: string, range: string): boolean {
  const [wantMajor, wantMinor, wantPatch] = parts(range);
  const [gotMajor, gotMinor, gotPatch] = parts(version);
  if (gotMajor !== wantMajor) return false;
  if (range.startsWith('~')) return gotMinor === wantMinor && gotPatch >= wantPatch;
  if (range.startsWith('^')) {
    return gotMinor > wantMinor || (gotMinor === wantMinor && gotPatch >= wantPatch);
  }
  return gotMinor === wantMinor && gotPatch === wantPatch;
}

describe('the SDK decides the version of everything it ships', () => {
  const governed = [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies),
  ]
    .filter((name) => name in bundled)
    .sort();

  it('governs the packages that matter — this is not an empty scan', () => {
    expect(governed).toContain('expo-font');
    expect(governed).toContain('react-native');
    expect(governed.length).toBeGreaterThan(5);
  });

  it.each(governed)('installs %s at the version this SDK ships', (name) => {
    const version = installedVersion(name);
    const range = bundled[name] ?? '';
    expect({ name, version, range, ok: version !== null && satisfies(version, range) }).toEqual({
      name,
      version,
      range,
      ok: true,
    });
  });

  it('resolves one copy of each at the root, not one per consumer', () => {
    // The SDK-57 `expo-font` was installed *beside* the SDK-52 one that
    // `expo` depends on, and a nested copy is how two versions of a
    // native module coexist without anything complaining.
    const nested = path.join(APP, 'node_modules', 'expo', 'node_modules');
    const shadowed = fs.existsSync(nested)
      ? fs.readdirSync(nested).filter((name) => name in bundled && installedVersion(name) !== null)
      : [];
    expect(shadowed).toEqual([]);
  });
});
