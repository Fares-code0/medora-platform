import fs from 'node:fs';
import path from 'node:path';

/**
 * A list that can grow is a windowed list — checklist W-08, `docs/PERF.md` §3.
 *
 * ── The defect this closes, and why a scan ──────────────────────────
 *
 * Every list in this app was `data.items.map(…)` inside `Screen`, which
 * is a `ScrollView`: it mounts every child it is handed and keeps it
 * mounted. `PERF.md` §3 recorded that as acceptable *while a list was one
 * server page*, and named the condition that would end it — "the first
 * thing that will matter if G-02's paging control lands and the list
 * grows". G-02, I-01 and O-01 all landed paging, so it landed.
 *
 * The fix is `PagedList`. What makes it stay fixed is this file: the
 * regression is not a broken test, it is a new screen written in the old
 * shape, and no render test can see a list that *would* be long. So this
 * reads the source instead and asks one question of it — does anything
 * render a paged query's items without the windowed container?
 *
 * ── What it deliberately allows ─────────────────────────────────────
 *
 * `EXPECTED` is a list of decisions, not a list of exemptions to get
 * round to. A bounded list — one page, with no control that asks for
 * another — cannot grow, and wrapping it in a virtualised container
 * costs a scroll context for nothing.
 */

const SRC = path.resolve(__dirname, '..');

/**
 * Rendering code. Services and adapters map over `items` to convert a
 * payload into a model, which is not what this asks about.
 */
const SCANNED = [
  path.join('features'),
  path.join('components'),
  path.join('navigation'),
  path.join('bootstrap'),
];

const RENDERING_SUBDIRECTORIES = ['screens', 'components', 'booking'];

/** Each entry: the file, and the decision that allows it. */
const EXPECTED: Readonly<Record<string, string>> = {
  'features/appointments/booking/BookingFlow.tsx':
    'the booking step renders one server page and offers no way to ask for another, so it cannot grow (BE-06/BE-07 own what it shows)',
};

function allFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allFiles(full);
    if (!/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) return [];
    return [full];
  });
}

function renderingFiles(): string[] {
  return SCANNED.flatMap((top) => allFiles(path.join(SRC, top))).filter((file) => {
    const relative = path.relative(SRC, file);
    if (!relative.startsWith('features')) return true;
    const [, , subdirectory] = relative.split(path.sep);
    return subdirectory !== undefined && RENDERING_SUBDIRECTORIES.includes(subdirectory);
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('paged lists are windowed (W-08 §3)', () => {
  it('renders no paged result with `.map`, outside the decisions that allow it', () => {
    const found: string[] = [];

    for (const file of renderingFiles()) {
      // `EXPECTED` is keyed with `/`; Windows would hand back `\`.
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      if (relative in EXPECTED) continue;
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      if (/\bitems\.map\(/.test(source)) found.push(relative);
    }

    expect(found).toEqual([]);
  });

  it('carries no exemption for a file that no longer renders one', () => {
    // An allow-list nobody prunes stops describing the tree and starts
    // hiding it.
    for (const allowed of Object.keys(EXPECTED)) {
      const full = path.join(SRC, allowed);
      const stillThere =
        fs.existsSync(full) &&
        /\bitems\.map\(/.test(withoutComments(fs.readFileSync(full, 'utf8')));
      expect({ allowed, stillThere }).toEqual({ allowed, stillThere: true });
    }
  });

  it('keeps every screen that pages on the windowed container', () => {
    // The three lists `PERF.md` §3 names, in the order it names them.
    // Each reaches `PagedList` — two directly, and the doctor lists
    // through `DoctorResults`, which is the shared one.
    const pagingScreens: Readonly<Record<string, string>> = {
      'features/notifications/screens/NotificationsScreen.tsx': 'PagedList',
      'features/appointments/screens/AppointmentsScreen.tsx': 'PagedList',
      'features/doctors/components/DoctorResults.tsx': 'PagedList',
      'features/doctors/screens/DiscoverScreen.tsx': 'DoctorResults',
      'features/clinic/screens/DepartmentScreen.tsx': 'DoctorResults',
    };

    for (const [file, container] of Object.entries(pagingScreens)) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect({ file, uses: new RegExp(`<${container}\\b`).test(source) }).toEqual({
        file,
        uses: true,
      });
    }
  });

  it('never nests the windowed list inside a scrolling `Screen`', () => {
    // A `FlatList` inside a `ScrollView` has no viewport of its own, so
    // it renders every row and warns at runtime. The screens above are
    // the scroll container; they do not sit in one.
    for (const file of renderingFiles()) {
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      if (!/<PagedList\b/.test(source)) continue;
      expect({
        file: path.relative(SRC, file),
        wrapsInScreen: /<Screen\b/.test(source),
      }).toEqual({ file: path.relative(SRC, file), wrapsInScreen: false });
    }
  });
});
