import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
  type RouteObject,
} from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { appRoutes } from '@/app/router';
import { routes } from '@/routes';

import { ContentAccessProvider } from './communications/ContentAccessProvider';
import { PhiAccessProvider } from './phi';
import { adminRoutes, clinicOperationsLoaders } from './routes';

/**
 * What the admin area serves at each of its three overview paths (ADM-01).
 *
 * The page itself is covered by `overview/AdminOverviewSection.test.tsx`; what
 * is only true here is the wiring — an administrator lands on the
 * Administrator Overview rather than on a clinic-operations page (UX §1.3),
 * the clinic page is still reachable at its new path, and the retired
 * `/admin/platform` still resolves instead of 404ing.
 *
 * `adminRoutes` is spread into a data router whole, rather than having three
 * of its routes read out and re-declared as plain `<Route>` elements. That
 * costs one stub (below) and buys the two things the re-declaration could not
 * check: the router resolves each `route.lazy` itself, exactly as the app
 * does, and a route that moved — renamed, or made a child of another — no
 * longer has its new shape quietly reproduced by the test that is supposed to
 * catch it.
 *
 * What a memory router still cannot see is whether the app mounts this array
 * at all, so the last block asserts that directly against the exported tree.
 * Mounting the whole of `appRoutes` would not have added to it: it drags in
 * the auth guards, the shell and every provider the app boots with, none of
 * which the claims below are about.
 */

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
  useToast: () => ({ toast: () => undefined }),
}));

beforeAll(() => {
  // Every data-router navigation builds a Request. Under jsdom the global
  // Request is Node's (undici) while AbortSignal is jsdom's, and undici
  // rejects a signal from another realm — an environment artifact, not app
  // behaviour. A structural stand-in is enough: these routes have no loaders.
  // (The same stub `sections/settings/PermissionMatrixPanel.test.tsx` uses.)
  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      readonly signal: AbortSignal | undefined;
      constructor(url: string, init?: { signal?: AbortSignal }) {
        this.url = url;
        this.signal = init?.signal;
      }
    },
  );
});

/** Stands in for the AppShell, and exposes the resolved path for redirects. */
function AreaLayout() {
  const { pathname } = useLocation();
  return (
    <>
      <span data-testid="pathname">{pathname}</span>
      <Outlet />
    </>
  );
}

/**
 * Testing Library's 1 s default is not enough for the first navigation here.
 * The data router resolves `route.lazy` itself — which is the point of
 * mounting it rather than re-declaring the routes — so the first assertion in
 * this file waits on the overview's whole chunk being imported and evaluated,
 * measured at just over a second on a cold registry. A budget, not a sleep:
 * the assertion is unchanged and still has to come true.
 */
const LAZY_ROUTE_MS = 8000;

/** Room for the wait above to be spent, rather than being cut off at 5 s. */
vi.setConfig({ testTimeout: LAZY_ROUTE_MS + 4000 });

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(
    [{ path: routes.admin.root, element: <AreaLayout />, children: [...adminRoutes] }],
    { initialEntries: [path], future: { v7_relativeSplatPath: true } },
  );
  return render(
    <QueryClientProvider client={client}>
      {/* The real tree wraps the whole /admin branch in the PHI gate and the
          content-access gate, and the overview renders identifiers that
          refuse to mount outside the former — the conversation viewer needs
          the latter, now that `ContentAccessProvider` is mounted one level
          up in `app/router/index.tsx` rather than inside `adminRoutes`
          itself (see the comment on the 'communications' route in
          `routes.tsx`). */}
      <PhiAccessProvider>
        <ContentAccessProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </ContentAccessProvider>
      </PhiAccessProvider>
    </QueryClientProvider>,
  );
}

/** The Administrator Overview's h1 — the dashboard greeting, for the mocked user. */
const ADMIN_GREETING = /^Good (morning|afternoon|evening), Marcus Reed$/;

describe('the admin area index', () => {
  it('serves the Administrator Overview at /admin', async () => {
    renderAt(routes.admin.root);

    // The Administrator Overview opens on the shared dashboard greeting, its
    // only h1 — so this is the overview and not the clinic page, which titles
    // itself with the clinic's name.
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: ADMIN_GREETING },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Clinic Overview')).not.toBeInTheDocument();
  });

  it('serves the System Logs page at /admin/logs', async () => {
    renderAt(routes.admin.logs);

    // `routes.admin.logs` was declared long before anything was mounted on it
    // (ADM-07 was roadmap item 12, taken after item 13), so this asserts the
    // route is now served rather than merely declared.
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'System Logs' },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
  });

  it('serves the Clinic Overview at /admin/clinic', async () => {
    renderAt(routes.admin.clinic);

    // The clinic page titles itself with the CLINIC'S NAME, which only arrives
    // once its overview document lands — so finding it proves both that this
    // route resolved and that its query ran.
    //
    // It used to be asserted through an overline reading "Clinic Overview"
    // above that title. The overline is gone: the page now takes the same
    // ContentHeader every other screen in both areas uses, which carries the
    // section's identity in its icon chip and description rather than in a
    // second line of text repeating the breadcrumb. The claim is unchanged —
    // this is the clinic page and not the Administrator Overview.
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /Medora Clinic/ },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: ADMIN_GREETING }),
    ).not.toBeInTheDocument();
  });

  it('redirects /admin/platform to the overview that absorbed it', async () => {
    renderAt('/admin/platform');

    await waitFor(
      () => {
        expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/admin$/);
      },
      { timeout: LAZY_ROUTE_MS },
    );
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: ADMIN_GREETING },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
  });
});

describe('the communications section', () => {
  it('serves the Communications section at /admin/communications', async () => {
    renderAt(routes.admin.communications);

    // SectionShell prints SECTION_META.communications.label as the page's
    // only h1 (see `administration.meta.ts`) — this is the value the crumb
    // in `routes.tsx` is also required to match, by
    // `administration.meta.test.ts`'s drift check.
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Communication Monitoring' },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
  });

  it('serves the conversation viewer as a route nested under the section', async () => {
    renderAt(`${routes.admin.communications}/conv-1`);

    // No grant exists in this harness, so `ConversationViewerPage`'s own
    // guard renders — which is itself proof the *viewer*, not the section
    // index, resolved for this URL: the section renders tabs, never this
    // alert. `CommunicationsSection`'s heading must NOT appear alongside it.
    expect(
      await screen.findByText('No active content access', undefined, {
        timeout: LAZY_ROUTE_MS,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Communication Monitoring' }),
    ).not.toBeInTheDocument();
  });

  it('declares the viewer as a child of the communications route, not a sibling', () => {
    // A structural check, deliberately not routed through `createMemoryRouter`:
    // that render above would pass identically whether `:conversationId` were
    // nested under `communications` or a same-named top-level sibling route
    // (`path: 'communications/:conversationId'`) — the resolved URL and
    // rendered component are indistinguishable either way. Only inspecting
    // the tree itself pins the nesting, which is what makes
    // `useMatches()` build "Communication Monitoring › Conversation" instead
    // of a crumb-less flat route.
    const section = adminRoutes.find((route) => route.path === 'communications');
    if (!section) throw new Error('no "communications" route is declared');

    const viewer = section.children?.find((route) => route.path === ':conversationId');
    expect(viewer, 'no ":conversationId" child under "communications"').toBeDefined();
  });
});

describe('the app router', () => {
  it('mounts the admin routes under /admin, where the tests above assume they are', () => {
    // The claim no in-test route tree can make. Without this, dropping
    // `...adminRoutes` from `app/router/index.tsx` — or nesting the area one
    // level deeper — leaves every test in this file green and the admin area
    // unreachable in the app.
    const branch = findRoute(appRoutes, routes.admin.root);
    if (!branch) throw new Error('no /admin branch is declared in the app router');

    for (const route of adminRoutes) {
      // Identity, not shape: a copy of the array would satisfy a deep
      // comparison while the app served something else.
      expect(branch.children).toContain(route);
    }
  });
});

/** Depth-first search for the route declaring `path`, at any nesting level. */
function findRoute(tree: readonly RouteObject[], path: string): RouteObject | undefined {
  for (const route of tree) {
    if (route.path === path) return route;
    const nested = route.children ? findRoute(route.children, path) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

/**
 * The reception workspace reuses the admin Queue and Waiting Room screens:
 * its loaders resolve to the very components the admin routes resolve to,
 * so there is one implementation of each, not a copy.
 */
describe('Queue and Waiting Room for reception', () => {
  it.each([
    ['queue', clinicOperationsLoaders.queue, 'QueueSection'],
    ['waiting-room', clinicOperationsLoaders.waitingRoom, 'WaitingRoomSection'],
  ] as const)('%s loads the same component as the admin route', async (path, load, name) => {
    const route = adminRoutes.find((entry) => entry.path === path);
    if (typeof route?.lazy !== 'function') throw new Error(`no lazy admin route ${path}`);
    const admin = (await route.lazy()) as { Component?: unknown };
    const reception = await load();
    expect(reception.Component).toBe(admin.Component);
    expect(reception.Component.name).toBe(name);
  });
});
