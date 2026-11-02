import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (local !== value) onChange(local); }, 320);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 ${className}`}>
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}