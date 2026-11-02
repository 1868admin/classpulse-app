export default function StatCard({ icon: Icon, label, value, hint, tone = 'default', onClick }) {
  const tones = {
    default: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`cp-card flex w-full items-start gap-3 p-4 text-left transition ${onClick ? 'hover:-translate-y-0.5 hover:shadow-md' : ''}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone] || tones.default}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-bold leading-tight">{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </Tag>
  );
}