import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/**
 * Sends a patient whose account is not linked (`409 patient_not_linked`)
 * to the linking screen — `LinkRecord`, in the Profile stack (ADR-048).
 */
export const PATIENT_LINK_ROUTE = 'LinkRecord';

export function openPatientLink(navigation: NavigationProp<ParamListBase>): void {
  navigation.navigate('Tabs', { screen: 'ProfileTab', params: { screen: PATIENT_LINK_ROUTE } });
}
