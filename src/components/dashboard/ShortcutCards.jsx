import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

export default function ShortcutCards({ items = [] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            to={item.to}
            className="cp-card group flex items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-sm font-semibold">
                {item.label}
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-primary" />
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.hint}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}