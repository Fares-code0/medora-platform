import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/**
 * Sends a patient whose account is not linked to the linking screen.
 *
 * The screen belongs to the identity work (`PatientLink`, in the Profile
 * stack). Until it is registered, navigating to it is a dead end that
 * React Navigation only warns about, so this checks the navigator state
 * first:
 *
 * - the route is registered somewhere in the tree → open it;
 * - the Profile stack has not been rendered yet (tabs mount lazily, so
 *   its routes are not in the state) → open it, the stack will know it;
 * - the Profile stack IS rendered and has no such route → open the Profile
 *   root instead, where the patient can still find their account.
 */
export const PATIENT_LINK_ROUTE = 'PatientLink';

interface NavState {
  readonly routeNames?: readonly string[];
  readonly routes?: readonly { readonly state?: NavState }[];
}

function collectRouteNames(state: NavState | undefined, into: Set<string>): void {
  if (state === undefined) return;
  for (const name of state.routeNames ?? []) into.add(name);
  for (const route of state.routes ?? []) collectRouteNames(route.state, into);
}

export function openPatientLink(navigation: NavigationProp<ParamListBase>): void {
  const names = new Set<string>();
  collectRouteNames(navigation.getState(), names);
  const profileRendered = names.has('ProfileRoot');
  const screen =
    !profileRendered || names.has(PATIENT_LINK_ROUTE) ? PATIENT_LINK_ROUTE : 'ProfileRoot';
  navigation.navigate('Tabs', { screen: 'ProfileTab', params: { screen } });
}
