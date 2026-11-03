import { Link } from 'react-router-dom';
import moment from 'moment';
import { ClipboardCheck, BookOpen, CalendarClock, GraduationCap, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import AppShell from '@/components/shell/AppShell';
import AttendanceOverview from '@/components/dashboard/AttendanceOverview';
import Calendar from '@/pages/Calendar';
import HeroPanel from '@/components/dashboard/HeroPanel';
import TeacherDocuments from '@/components/timetable/TeacherDocuments';
import StatCard from '@/components/dashboard/StatCard';
import ShortcutCards from '@/components/dashboard/ShortcutCards';
import { useSchool } from '@/context/SchoolContext';
import { useTeacherDashboard } from '@/hooks/useDashboard';
import { fmtTime } from '@/lib/dates';
import { staffGreetingName } from '@/lib/staffName';

export default function TeacherDashboard() {
  const { schoolId, school, user, member } = useSchool();
  const data = useTeacherDashboard(schoolId, member?.id);
  const greetingName = staffGreetingName(member, user);

  const submitted = new Set((data.sessions || []).map((s) => `${s.class_id}|${s.session_label}`));
  const dayLabel = data.hasNoSchool
    ? `No school — ${data.calendar?.reason || 'closed'}`
    : data.calendarMissing
      ? 'Calendar not assigned for today'
      : data.dayName || 'No timetable day';

  return (
    <AppShell title="Dashboard">
      <div className="space-y-4">
        <HeroPanel
          schoolName={school?.name || 'Your school'}
          greeting={`Good day, ${greetingName}`}
          context={`${moment().format('dddd D MMMM YYYY')} · ${dayLabel} · ${data.outstanding ? `${data.outstanding} register${data.outstanding === 1 ? '' : 's'} outstanding` : 'no registers pending'}`}
          controls={
            <Link to="/attendance" className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-[#1d4ed8] shadow-sm transition hover:bg-blue-50">
              Take attendance <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
          stats={[
            { label: 'My classes', value: data.loading ? '—' : data.homeroomCount + data.subjectCount },
            { label: 'Submitted today', value: data.loading ? '—' : data.submittedToday },
            { label: 'Outstanding', value: data.loading ? '—' : data.outstanding },
            { label: 'Students', value: data.loading ? '—' : data.studentTotal, hint: 'Across my classes' },
          ]}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={GraduationCap} label="My homerooms" value={data.loading ? '—' : data.homeroomCount} tone="blue" />
          <StatCard icon={BookOpen} label="Subject classes" value={data.loading ? '—' : data.subjectCount} tone="violet" />
          <StatCard icon={CalendarClock} label="Lessons today" value={data.loading ? '—' : (data.todayEntries || []).length} tone="amber" />
          <StatCard icon={ClipboardCheck} label="Unsubmitted" value={data.loading ? '—' : data.outstanding} tone="green" />
        </div>

        <AttendanceOverview attendanceRows={data.attendanceRows} loading={data.loading} />

        {data.homeroomRows?.length > 0 && (
          <section className="cp-card overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-bold">My homeroom attendance</h2>
              <p className="text-xs text-muted-foreground">Students marked present today</p>
            </div>
            <div className="divide-y divide-border/60 sm:grid sm:grid-cols-2 sm:divide-y-0">
              {data.homeroomRows.map((klass) => (
                <div key={klass.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:border-b sm:border-border/60">
                  <p className="min-w-0 truncate text-sm font-semibold">{klass.name}</p>
                  <div className="flex shrink-0 gap-3 text-xs text-muted-foreground">
                    <span>Boys <strong className="text-foreground">{klass.boysPresent}</strong></span>
                    <span>Girls <strong className="text-foreground">{klass.girlsPresent}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <ShortcutCards
          items={[
            { label: 'Take attendance', to: '/attendance', icon: ClipboardCheck, hint: 'Open today\'s registers' },
            { label: 'My classes', to: '/subject-classes', icon: BookOpen, hint: 'Manage class lists' },
            { label: 'My timetable', to: '/timetable', icon: CalendarClock, hint: 'Lessons and rooms' },
          ]}
        />

        <TeacherDocuments />

        <section className="cp-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-bold">Examination supervision</h2>
              <p className="text-xs text-muted-foreground">Your published invigilation assignments</p>
            </div>
            <Link to="/timetable?view=invigilation" className="text-xs font-semibold text-primary hover:underline">Full schedule</Link>
          </div>
          {(data.supervisionAssignments || []).length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">No upcoming published supervision assignments.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {(data.supervisionAssignments || []).slice(0, 5).map((assignment) => (
                <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{assignment.exam_date} · {assignment.start_time}–{assignment.end_time} · {assignment.exam_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{assignment.subject} · {assignment.room}</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    {assignment.role === 'chief' ? 'Chief supervisor' : 'Assistant supervisor'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="cp-card lg:col-span-3">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-bold">My day</h2>
              <p className="text-xs text-muted-foreground">{data.dayName || 'Timetable day not set'} · {moment().format('dddd')}</p>
            </div>
            <div className="divide-y divide-border/60">
              {(data.todayEntries || []).length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No lessons scheduled for today{data.calendarMissing ? ' — ask an administrator to assign this date on the school calendar.' : '.'}
                </p>
              )}
              {(data.todayEntries || []).map((e) => {
                const done = submitted.has(`${e.subject_class_id}|Period ${e.period_number}`);
                return (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-14 shrink-0 rounded-lg bg-muted px-2 py-1 text-center">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">P{e.period_number}</p>
                      <p className="text-[11px] font-medium">{fmtTime(e.start_time)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{e.subject || 'Lesson'}</p>
                      <p className="truncate text-xs text-muted-foreground">{e.class_name}{e.room ? ` · ${e.room}` : ''}</p>
                    </div>
                    {done ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Done</span>
                    ) : (
                      <Link to={`/attendance?class=${e.subject_class_id}&period=${e.period_number}`} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                        <AlertCircle className="h-3.5 w-3.5" />Take
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="cp-card lg:col-span-2">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-bold">Recent attendance</h2>
              <p className="text-xs text-muted-foreground">Registers you submitted</p>
            </div>
            <div className="divide-y divide-border/60">
              {(data.sessions || []).length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing submitted today yet.</p>}
              {(data.sessions || []).slice(0, 6).map((s) => (
                <div key={s.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{s.class_name} · {s.session_label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.present_count} present · {s.absent_count} absent · {s.late_count} late
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-2.5">
              <Link to="/attendance" className="text-xs font-semibold text-primary hover:underline">Attendance history</Link>
            </div>
          </div>
          <Calendar compact />
        </div>
      </div>
    </AppShell>
  );
}