import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';

const ATTENDANCE_TABS = [
  { id: 'morning', label: 'Morning Form' },
  { id: 'afternoon', label: 'Afternoon Form' },
  { id: 'subject', label: 'Subject Lessons' },
];

function registerUrl(row) {
  const params = new URLSearchParams({
    class: row.classId,
    type: row.classType,
    date: row.date,
    label: row.label,
  });
  if (row.periods?.length > 1) params.set('periods', row.periods.join(','));
  else if (row.periods?.length === 1) params.set('period', String(row.periods[0]));
  return `/attendance/register?${params.toString()}`;
}

function AttendanceRows({ rows, search }) {
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [row.className, row.subject, row.teacher, row.label]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(query));
  }, [rows, search]);

  if (!rows.length) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No attendance registers are scheduled for this view.</p>;
  }
  if (!visibleRows.length) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No classes match your search.</p>;
  }

  return (
    <div role="region" aria-label="Class attendance registers" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="cp-table-head">
          <tr>
            <th className="px-4 py-2 text-left">Class</th>
            <th className="px-4 py-2 text-left">Assigned teacher</th>
            <th className="px-4 py-2 text-right">Enrolled</th>
            <th className="px-4 py-2 text-right">Present</th>
            <th className="px-4 py-2 text-right">Absent</th>
            <th className="px-4 py-2 text-right">Late</th>
            <th className="px-4 py-2 text-right">Attendance</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.key} className="border-t border-border/70">
              <td className="px-4 py-2.5">
                <p className="font-medium">{row.className}</p>
                <p className="text-[11px] text-muted-foreground">
                  {row.classType === 'subject' && row.subject ? `${row.subject} · ` : ''}{row.label}
                </p>
              </td>
              <td className="max-w-[200px] truncate px-4 py-2.5 text-xs text-muted-foreground" title={row.teacher}>
                {row.teacher}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{row.enrolled}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{row.present}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{row.absent}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{row.late}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {row.rate === null ? '—' : `${row.rate.toFixed(1)}%`}
              </td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  row.session
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${row.session ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {row.session ? 'Submitted' : 'Pending'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  to={registerUrl(row)}
                  className="inline-flex whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
                >
                  {row.session ? 'View Register' : 'Take Register'}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AttendanceOverview({ attendanceRows = { morning: [], afternoon: [], subject: [] }, loading = false }) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('morning');
  const handleTabKeyDown = (event) => {
    const currentIndex = ATTENDANCE_TABS.findIndex((tab) => tab.id === activeTab);
    const nextIndex = event.key === 'ArrowRight'
      ? (currentIndex + 1) % ATTENDANCE_TABS.length
      : event.key === 'ArrowLeft'
        ? (currentIndex + ATTENDANCE_TABS.length - 1) % ATTENDANCE_TABS.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? ATTENDANCE_TABS.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = ATTENDANCE_TABS[nextIndex];
    setActiveTab(nextTab.id);
    event.currentTarget.parentElement?.querySelector(`[data-attendance-tab="${nextTab.id}"]`)?.focus();
  };
  return (
    <section className="cp-card min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-heading text-lg font-semibold">Class attendance</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Register counts and submission status for today</p>
          </div>
          <Link to="/attendance" className="text-xs font-semibold text-primary hover:underline">Attendance centre</Link>
        </div>
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-auto" role="tablist" aria-label="Attendance forms">
              {ATTENDANCE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`attendance-tab-${tab.id}`}
                  aria-controls={`attendance-panel-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  data-attendance-tab={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={handleTabKeyDown}
                  className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm ${
                    activeTab === tab.id ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <label className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search classes or teachers"
                aria-label="Search classes or teachers"
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          {ATTENDANCE_TABS.filter((tab) => tab.id === activeTab).map((tab) => (
            <div key={tab.id} id={`attendance-panel-${tab.id}`} role="tabpanel" aria-labelledby={`attendance-tab-${tab.id}`} className="mt-3">
              {loading
                ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading class attendance…</p>
                : <AttendanceRows rows={attendanceRows[tab.id] || []} search={search} />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
