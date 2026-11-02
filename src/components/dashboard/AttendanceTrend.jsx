import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function AttendanceTrend({ data = [], title = 'Attendance trend', subtitle }) {
  const [mode, setMode] = useState('present_late');
  const series = [
    { key: 'present', label: 'Present only', color: 'hsl(var(--chart-1))' },
    { key: 'present_late', label: 'Present + late', color: 'hsl(var(--chart-2))' },
    { key: 'absent', label: 'Absent', color: 'hsl(var(--chart-5))' },
  ];
  const current = series.find((s) => s.key === mode);

  return (
    <div className="cp-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle || 'Rolling 7-day attendance rate'}</p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
          {series.map((s) => (
            <button
              key={s.key}
              onClick={() => setMode(s.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${mode === s.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }}
              formatter={(v) => [`${v}%`, current.label]}
            />
            <Line type="monotone" dataKey={current.key} stroke={current.color} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}