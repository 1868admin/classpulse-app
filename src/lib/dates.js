import moment from 'moment';

export const todayStr = () => moment().format('YYYY-MM-DD');

export const fmtDate = (d) => (d ? moment(d).format('ddd D MMM YYYY') : '—');

export const fmtShort = (d) => (d ? moment(d).format('D MMM') : '—');

export const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')}${suffix}`;
};

export const attendanceRate = (present, total) => (total ? Math.round((present / total) * 100) : 0);

export const STATUS_STYLES = {
  present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  absent: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  late: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  excused: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  other: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const ATTENDANCE_STATUSES = [
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Absent' },
  { key: 'excused', label: 'Excused' },
];