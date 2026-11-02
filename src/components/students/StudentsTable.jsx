import { Pencil, Archive, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtShort } from '@/lib/dates';

const badge = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  inactive: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  transferred: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  graduated: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
};

export default function StudentsTable({ students, selected, onToggle, onToggleAll, onEdit, onArchive, onRestore, canManage }) {
  const allSelected = students.length > 0 && students.every((s) => selected.has(s.id));

  return (
    <>
      <div className="cp-card hidden overflow-hidden md:block">
        <div className="cp-scroll-x">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="cp-table-head">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => onToggleAll(students)} className="h-4 w-4 rounded border-border" />
              </th>
              <th className="px-3 py-2.5">Student ID</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Year group</th>
              <th className="px-3 py-2.5">Homeroom</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Enrolled</th>
              <th className="w-24 px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-t border-border/60 hover:bg-muted/40">
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${s.full_name}`}
                    checked={selected.has(s.id)}
                    onChange={() => onToggle(s.id)}
                    className="h-4 w-4 rounded border-border"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">{s.student_id_no}</td>
                <td className="px-3 py-2.5 font-medium">
                  {s.surname}, {s.first_name}{s.middle_name ? ` ${s.middle_name[0]}.` : ''}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{s.year_group_name || '—'}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{s.homeroom_class_name || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${badge[s.status] || badge.inactive}`}>{s.status}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{s.date_enrolled ? fmtShort(s.date_enrolled) : '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {canManage && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(s)} aria-label={`Edit ${s.full_name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManage && (s.archived ? (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRestore(s)} aria-label="Restore">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => onArchive(s)} aria-label="Archive">
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="space-y-2 md:hidden">
        {students.map((student) => (
          <article key={student.id} className="cp-card space-y-3 p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label={`Select ${student.full_name}`}
                checked={selected.has(student.id)}
                onChange={() => onToggle(student.id)}
                className="mt-1 h-5 w-5 shrink-0 rounded border-border"
              />
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-semibold">{student.full_name || `${student.first_name} ${student.surname}`}</h3>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">ID: {student.student_id_no || 'Not assigned'}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${badge[student.status] || badge.inactive}`}>
                {student.status}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs">
              <div><dt className="text-muted-foreground">Year group</dt><dd className="break-words font-medium">{student.year_group_name || '—'}</dd></div>
              <div><dt className="text-muted-foreground">Homeroom</dt><dd className="break-words font-medium">{student.homeroom_class_name || '—'}</dd></div>
              <div><dt className="text-muted-foreground">Enrolled</dt><dd className="font-medium">{student.date_enrolled ? fmtShort(student.date_enrolled) : '—'}</dd></div>
              <div className="flex items-end justify-end gap-1">
                {canManage && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(student)}>Edit</Button>
                )}
                {canManage && (student.archived ? (
                  <Button variant="outline" size="sm" onClick={() => onRestore(student)}>Restore</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => onArchive(student)}>Archive</Button>
                ))}
              </div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}