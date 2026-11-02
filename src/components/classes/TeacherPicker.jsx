import { useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';

export default function TeacherPicker({ members, value = [], primaryId, onChange, onPrimaryChange }) {
  const [term, setTerm] = useState('');
  const filtered = useMemo(
    () => members.filter((m) => m.full_name?.toLowerCase().includes(term.toLowerCase())),
    [members, term],
  );

  const toggle = (id) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    onChange(next);
    if (primaryId && !next.includes(primaryId)) onPrimaryChange?.(next[0] || '');
  };

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find a teacher…" className="w-full bg-transparent text-xs outline-none" />
      </div>
      <div className="max-h-48 overflow-y-auto p-1.5">
        {filtered.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No teacher accounts match.</p>}
        {filtered.map((m) => {
          const checked = value.includes(m.id);
          return (
            <div key={m.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${checked ? 'bg-accent/60' : 'hover:bg-muted'}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} className="h-4 w-4 rounded border-border" aria-label={m.full_name} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{m.full_name}</span>
              {checked && (
                <button
                  type="button"
                  onClick={() => onPrimaryChange?.(m.id)}
                  title="Mark as primary teacher"
                  className={`rounded p-1 ${primaryId === m.id ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'}`}
                >
                  <Star className={`h-3.5 w-3.5 ${primaryId === m.id ? 'fill-amber-500' : ''}`} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}