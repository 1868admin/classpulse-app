import { Sparkles } from 'lucide-react';

/**
 * Blue gradient hero used by the admin and teacher dashboards.
 */
export default function HeroPanel({ schoolName, greeting, context, controls, stats }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e40af] via-[#1d4ed8] to-[#2563eb] p-5 text-white shadow-lg sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-sky-300/10 blur-2xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-100">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="truncate">{schoolName}</span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight sm:text-[32px]">{greeting}</h1>
          <p className="mt-1.5 max-w-xl text-sm text-blue-100/90">{context}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{controls}</div>
      </div>
      <div className="relative mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-white/20 bg-white/10 px-3.5 py-3 backdrop-blur-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-blue-100/90">{s.label}</p>
            <p className="mt-1 text-2xl font-bold leading-none">{s.value}</p>
            {s.hint && <p className="mt-1 text-[11px] text-blue-100/75">{s.hint}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}