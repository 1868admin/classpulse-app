import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, LogOut, Menu, Search, Bell, X } from 'lucide-react';
import { navForRoles, ROLE_LABELS } from '@/lib/nav';
import ThemeToggle from '@/components/shell/ThemeToggle';
import { useSchool } from '@/context/SchoolContext';
import { base44 } from '@/api/base44Client';
import { staffDisplayName } from '@/lib/staffName';

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'CP';
}

export default function AppShell({ title, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, member, school, roles, primaryRole } = useSchool();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [q, setQ] = useState('');
  const sections = navForRoles(roles);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (path) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));
  const displayName = staffDisplayName(member, user) || user?.email || 'Signed in';

  const drawer = (
    <>
      <div
        onClick={() => setDrawerOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] transition-opacity ${drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <aside className={`fixed left-0 top-0 z-50 flex h-full w-[272px] flex-col overflow-y-auto border-r border-border bg-card transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">CP</span>
            <span className="font-heading text-base font-extrabold tracking-tight">CLASSPULSE</span>
          </Link>
          <button onClick={() => setDrawerOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">School</p>
          <p className="truncate text-sm font-semibold">{school?.name || 'No school assigned'}</p>
        </div>
        <nav className="flex-1 space-y-5 px-3 py-4">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${isActive(item.path) ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initials(displayName)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{ROLE_LABELS[primaryRole]}</p>
            </div>
            <button onClick={() => base44.auth.logout(window.location.href)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
          <button onClick={() => setDrawerOpen(true)} className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">ClassPulse</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <span className="truncate text-sm font-semibold md:hidden">{title}</span>

          <div className="ml-auto flex items-center gap-1.5">
            <form
              onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/students?q=${encodeURIComponent(q.trim())}`); }}
              className="hidden items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 lg:flex"
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search..."
                className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground xl:w-48"
              />
              <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">⌘K</kbd>
            </form>
            <ThemeToggle />
            <Link to="/attendance" className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Attendance">
              <Bell className="h-4 w-4" />
            </Link>
            <div className="ml-1 flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-1 sm:pr-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(displayName)}</span>
              <div className="hidden leading-tight sm:block">
                <p className="max-w-[140px] truncate text-xs font-semibold">{displayName}</p>
                <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[primaryRole]}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {drawer}
      <main className="mx-auto max-w-[1440px] px-3 py-5 sm:px-5 sm:py-6">{children}</main>
    </div>
  );
}