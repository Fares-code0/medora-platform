import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { headingA11y } from '@/accessibility/a11y';
import { Card, Section, Text } from '@/components';
import { DoctorResults } from '@/features/doctors/components/DoctorResults';
import { useDoctorSearch } from '@/features/doctors/hooks';
import { useT } from '@/i18n';
import type { DiscoverStackParamList } from '@/navigation/routes';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'Department'>;

/**
 * The doctors in one department — checklist H-05.
 *
 * ── This one is live, and it is worth saying which half ──────────────
 *
 * The list of doctors comes from `GET /patient/doctors?departmentId=…`,
 * which is BE-04 and has been live since the patient-facing projection
 * landed. So this screen is not a fixture screen: on a production build
 * it shows real practitioners, paged by the server, through the same
 * `useDoctorSearch` Discover uses.
 *
 * The way IN is the fixture half. A patient reaches here from the
 * clinic page's department list, and that list is `listDepartments` —
 * `GET /patient/departments`, not built (BE-11 / M23). So the screen
 * works and is hard to reach in production, which is the opposite of
 * the usual arrangement and the reason H-05 stays 🟨.
 *
 * ── Why the name travels in the route params ─────────────────────────
 *
 * The header says which department this is, and there is no
 * `GET /patient/departments/{id}` to ask. The name is passed by the
 * screen that already had it, which is honest — a patient can only
 * arrive here from a list that named the department — and it costs no
 * request. `departmentId` alone would leave the header either blank or
 * guessing.
 *
 * There is deliberately no deep link to this route (`linking.ts`). A
 * `medora://departments/DP-3` would arrive with an id and no name, and
 * a screen that has to be reachable cold is a screen that needs the
 * endpoint this one does not have.
 */
export function DepartmentScreen({ route, navigation }: Props) {
  const t = useT();
  const { departmentId, departmentName, description } = route.params;
  const doctors = useDoctorSearch({ departmentId });

  return (
    <DoctorResults
      query={doctors}
      screenTestID="department-screen"
      testIDPrefix="department"
      onOpen={(doctorId) => navigation.navigate('DoctorProfile', { doctorId })}
      // Not "try a different search": nothing was searched for. A
      // department with nobody in it is an answer, and the body says
      // where to look instead rather than implying a mistake.
      emptyTitleKey="department.empty.title"
      emptyBodyKey="department.empty.body"
      header={
        <>
          <Text variant="h1" {...headingA11y(departmentName)}>
            {departmentName}
          </Text>

          {description === undefined || description === null ? null : (
            <Card tone="sunken" testID="department-description">
              <Text variant="bodySm" color="textSecondary">
                {description}
              </Text>
            </Card>
          )}

          <Section
            title={t('department.doctors')}
            subtitle={
              doctors.data === undefined
                ? undefined
                : t('discover.doctors.count', { count: doctors.data.totalItems })
            }
          >
            {null}
          </Section>
        </>
      }
    />
  );
}
