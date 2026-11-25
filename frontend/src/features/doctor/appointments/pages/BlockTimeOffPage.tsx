import { ArrowLeft, CalendarOff, CalendarRange } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { Breadcrumb, Button } from '@/components/ui';
import { useT } from '@/i18n';
import { routes } from '@/routes';

import { BlockTimeOffForm } from '../components/BlockTimeOffForm';

/**
 * Block Time Off (UX §2.4, API §3.9) — the page that replaced the Appointments
 * toolbar's dialog. The flow is BlockTimeOffForm's, including the guard that
 * keeps a booked block's follow-up from being abandoned silently; this page
 * frames it and, once the server has confirmed, announces it and moves to the
 * doctor's upcoming time off.
 */
export function BlockTimeOffPage() {
  const t = useT();
  const navigate = useNavigate();
  const { toast } = useToast();

  return (
    <PageContainer width="lg">
      <PageSections>
        <ContentHeader
          title={t('route.blockTimeOff')}
          icon={CalendarOff}
          tone="warning"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: t('nav.overview'), href: routes.doctor.overview },
                { label: t('nav.appointments'), href: routes.doctor.appointments },
                { label: t('route.blockTimeOff') },
              ]}
            />
          }
          actions={
            <>
              <Button
                variant="ghost"
                leadingIcon={ArrowLeft}
                onClick={() => navigate(routes.doctor.appointments)}
              >
                {t('timeOff.back')}
              </Button>
              <Button
                variant="secondary"
                leadingIcon={CalendarRange}
                onClick={() => navigate(routes.doctor.upcomingTimeOff)}
              >
                {t('route.upcomingTimeOff')}
              </Button>
            </>
          }
        />

        <BlockTimeOffForm
          onCancel={() => navigate(routes.doctor.upcomingTimeOff)}
          onFinished={(options) => {
            if (options !== null) toast(options);
            navigate(routes.doctor.upcomingTimeOff);
          }}
        />
      </PageSections>
    </PageContainer>
  );
}
