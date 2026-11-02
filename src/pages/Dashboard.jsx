import { AlertTriangle, ArrowRight, CalendarDays, ClipboardCheck, TrendingUp, UserRoundX, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import moment from 'moment';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AppShell from '@/components/shell/AppShell';
import { useSchool } from '@/context/SchoolContext';
import { useAdminDashboard } from '@/hooks/useDashboard';
import TeacherDashboard from '@/pages/TeacherDashboard';

function StatTile({ icon: Icon, label, value, detail, tone = 'default' }) {
  const iconTones = {
    default: 'text-emerald-500',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
  };
  return (
    <section className="cp-card min-w-0 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</h2>
        <Icon className={`h-4 w-4 shrink-0 ${iconTones[tone] || iconTones.default}`} aria-hidden="true" />
      </div>
      <p className={`mt-2 font-heading text-3xl leading-none tracking-tight ${tone === 'amber' ? 'text-amber-500' : ''}`}>{value}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

function AttendanceStatus({ status }) {
  const styles = {
    complete: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    partial: 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    not_taken: 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  };
  const labels = { complete: 'Complete', partial: 'Partially complete', not_taken: 'Not taken' };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'complete' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {labels[status]}
    </span>
  );
}

function percentLabel(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function ClassAttendance({ classes }) {
  if (!classes.length) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No active homeroom classes yet.</p>;
  }

  return (
    <>
      <div className="hidden max-h-[300px] overflow-auto md:block">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="sticky top-0 z-10 bg-card text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="px-4 pb-2 text-left">Class</th>
              <th className="px-4 pb-2 text-left">Enrolled</th>
              <th className="px-4 pb-2 text-left">Boys present</th>
              <th className="px-4 pb-2 text-left">Girls present</th>
              <th className="px-4 pb-2 text-left">Today</th>
              <th className="px-4 pb-2 text-right">Month</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((klass) => (
              <tr key={klass.id} className="border-t border-border/70">
                <td className="px-4 py-2 font-medium">{klass.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{klass.enrolled}</td>
                <td className="px-4 py-2 text-muted-foreground">{klass.boysPresent}</td>
                <td className="px-4 py-2 text-muted-foreground">{klass.girlsPresent}</td>
                <td className="px-4 py-2.5"><AttendanceStatus status={klass.todayStatus} /></td>
                <td className="px-4 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{percentLabel(klass.monthRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="max-h-[300px] divide-y divide-border/70 overflow-y-auto md:hidden">
        {classes.map((klass) => (
          <div key={klass.id} className="space-y-2.5 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{klass.name}</p>
              <AttendanceStatus status={klass.todayStatus} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{klass.enrolled} enrolled</span>
              <span>Month <strong className="text-emerald-600 dark:text-emerald-400">{percentLabel(klass.monthRate)}</strong></span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Boys present <strong className="text-foreground">{klass.boysPresent}</strong></span>
              <span>Girls present <strong className="text-foreground">{klass.girlsPresent}</strong></span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Dashboard() {
  const { schoolId, school, isStaff, isTeacher } = useSchool();
  const admin = useAdminDashboard(schoolId, school?.attendance_alert_threshold);

  if (isTeacher && !isStaff) return <TeacherDashboard />;

  const outstanding = Math.max(0, admin.homerooms - admin.registerCount);
  const attendanceThisMonth = admin.monthTotals.students
    ? ((admin.monthTotals.present + admin.monthTotals.late) / admin.monthTotals.students) * 100
    : null;

  return (
    <AppShell title="Dashboard">
      <div className="space-y-5">
        <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Attendance overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">A quick read on every class, today&apos;s registers, and the students who may need a check-in.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/reports" className="rounded-full border border-border px-4 py-2 text-xs font-medium transition hover:bg-muted">Reports</Link>
            <Link to="/attendance" className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700">
              Take attendance <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          {moment().format('dddd, D MMMM YYYY')}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={Users}
            label="Students"
            value={admin.loading ? '—' : admin.students.toLocaleString()}
            detail={`Across ${admin.homerooms} ${admin.homerooms === 1 ? 'class' : 'classes'}`}
          />
          <StatTile
            icon={ClipboardCheck}
            label="Registers today"
            value={admin.loading ? '—' : `${admin.registerCount}/${admin.homerooms}`}
            detail={outstanding ? `${outstanding} still outstanding` : 'All class registers submitted'}
            tone={outstanding ? 'amber' : 'default'}
          />
          <StatTile
            icon={TrendingUp}
            label="Attendance this month"
            value={admin.loading ? '—' : percentLabel(attendanceThisMonth)}
            detail="Present + late · recorded registers"
          />
          <StatTile
            icon={UserRoundX}
            label="Absences this month"
            value={admin.loading ? '—' : admin.monthTotals.absent.toLocaleString()}
            detail={`${admin.monthTotals.late.toLocaleString()} late arrivals`}
            tone="rose"
          />
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <section className="cp-card min-w-0 overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
              <h2 className="font-heading text-lg font-semibold">Classes</h2>
              <Link to="/homerooms" className="shrink-0 text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">Manage classes</Link>
            </div>
            {admin.loading
              ? <p className="px-5 py-6 text-sm text-muted-foreground">Loading class attendance…</p>
              : <ClassAttendance classes={admin.classRows} />}
          </section>

          <section className="cp-card min-w-0 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="font-heading text-lg font-semibold">Needs attention</h2>
            </div>
            {admin.loading ? (
              <p className="mt-4 text-sm text-muted-foreground">Checking this month&apos;s attendance…</p>
            ) : admin.monthTotals.students === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No attendance has been recorded this month yet.</p>
            ) : admin.flaggedStudents.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No students are below the {admin.threshold}% attendance threshold this month.</p>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {admin.flaggedStudents.length} student{admin.flaggedStudents.length === 1 ? '' : 's'} below the {admin.threshold}% attendance threshold.
                </p>
                <ul className="mt-3 divide-y divide-border/70">
                  {admin.flaggedStudents.map((student) => (
                    <li key={student.studentId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate font-medium">{student.name}</span>
                      <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">{percentLabel(student.rate)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Flags use the attendance threshold in <Link to="/settings" className="font-medium underline underline-offset-2">Settings</Link>. They help identify students who may need support.
            </p>
          </section>
        </div>

        <section className="cp-card min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-heading text-lg font-semibold">Daily attendance this month</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Present and late, across homeroom registers</p>
            </div>
            <span className="text-xs text-muted-foreground">{admin.recordedDays} recorded {admin.recordedDays === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="mt-4 h-56 w-full overflow-hidden">
            {admin.loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading attendance…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={admin.monthlyTrend} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    labelFormatter={(value) => moment(`${moment().format('YYYY-MM')}-${String(value).padStart(2, '0')}`).format('D MMMM')}
                    formatter={(value) => [value === null || value === undefined ? 'No register' : `${Number(value).toFixed(1)}%`, 'Attendance']}
                    contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="rate" stroke="hsl(var(--chart-2))" strokeWidth={2.5} dot={{ r: 2.5, strokeWidth: 1.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
        {admin.dataTruncated && (
          <p className="text-xs text-amber-700 dark:text-amber-300">Some dashboard figures are limited to the first 100,000 records. Narrow the date range in Reports for a complete detailed view.</p>
        )}
      </div>
    </AppShell>
  );
}
