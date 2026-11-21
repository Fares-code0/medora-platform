import { Coffee } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Input, Switch } from '@/components/ui';
import { cn } from '@/utils/cn';

import { useWorkingSchedule, useWorkingScheduleMutations } from '../api/useAdministrationQueries';
import { AsyncSection, Panel } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';

/**
 * ScheduleSection — clinic working hours (Phase 17; editable in Phase B).
 * A seven-day strip of opening hours. Each day is edited in place: a switch
 * opens or closes it and the times are plain inputs, because seven fixed
 * weekdays are not a collection you add to — there is nothing to create or
 * delete, only to adjust.
 */
export function ScheduleSection() {
  const schedule = useWorkingSchedule();
  const { setDay } = useWorkingScheduleMutations();
  const { toast } = useToast();

  return (
    <SectionShell slug="schedule">
      <AsyncSection
        isLoading={schedule.isLoading}
        isError={schedule.isError}
        onRetry={() => void schedule.refetch()}
      >
        <Panel title="This week" description="Clinic opening hours">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {(schedule.data ?? []).map((day) => (
              <div
                key={day.day}
                className={cn(
                  'flex flex-col gap-2 rounded-surface border p-3',
                  day.open ? 'border-border bg-surface' : 'border-border bg-surface-sunken',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body-sm font-semibold text-text-primary">{day.day}</span>
                  <Switch
                    checked={day.open}
                    onCheckedChange={(open) => {
                      setDay.mutate(
                        { day: day.day, changes: { open } },
                        {
                          onSuccess: () =>
                            toast({
                              variant: 'success',
                              title: day.day + (open ? ' is now open' : ' is now closed'),
                            }),
                          onError: () =>
                            toast({ variant: 'error', title: "Couldn't update " + day.day }),
                        },
                      );
                    }}
                    aria-label={'Open on ' + day.day}
                  />
                </div>
                {day.open ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="time"
                        value={day.start}
                        aria-label={'Opening time on ' + day.day}
                        onChange={(event) =>
                          setDay.mutate({ day: day.day, changes: { start: event.target.value } })
                        }
                      />
                      <span aria-hidden="true" className="text-text-tertiary">
                        –
                      </span>
                      <Input
                        type="time"
                        value={day.end}
                        aria-label={'Closing time on ' + day.day}
                        onChange={(event) =>
                          setDay.mutate({ day: day.day, changes: { end: event.target.value } })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1.5 text-caption text-text-tertiary">
                      <Coffee aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <Input
                        value={day.breakLabel ?? ''}
                        placeholder="No break"
                        aria-label={'Break on ' + day.day}
                        onChange={(event) =>
                          setDay.mutate({
                            day: day.day,
                            changes: { breakLabel: event.target.value || undefined },
                          })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-caption text-text-tertiary">Clinic closed</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </AsyncSection>
    </SectionShell>
  );
}
