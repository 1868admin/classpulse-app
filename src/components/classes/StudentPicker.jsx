import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';

export default function StudentPicker({ open, onOpenChange, yearGroups, homerooms, excludeIds = [], onConfirm, title = 'Add students' }) {
  const { schoolId } = useSchool();
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [term, setTerm] = useState('');
  const [yearGroupId, setYearGroupId] = useState('all');
  const [homeroomId, setHomeroomId] = useState('all');
  const [sortBy, setSortBy] = useState('surname-asc');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!open || !schoolId) return;
    setLoading(true);
    const clauses = [{ school_id: schoolId, archived: { $ne: true } }];
    if (yearGroupId !== 'all') clauses.push({ year_group_id: yearGroupId });
    if (homeroomId !== 'all') clauses.push({ homeroom_class_id: homeroomId });
    if (term.trim()) {
      clauses.push({
        $or: [
          { student_id_no: { $regex: term.trim(), $options: 'i' } },
          { full_name: { $regex: term.trim(), $options: 'i' } },
          { surname: { $regex: term.trim(), $options: 'i' } },
        ],
      });
    }
    const page = await base44.entities.Student.filter({ $and: clauses }, { limit: 100, sort: 'surname' });
    setRows(page.items || []);
    setLoading(false);
  }, [open, schoolId, yearGroupId, homeroomId, term]);

  useEffect(() => { const t = setTimeout(load, 260); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (open) { setSelected(new Set()); setConfirming(false); } }, [open]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const sortedRows = rows.toSorted((left, right) => {
    const field = sortBy.startsWith('id') ? 'student_id_no' : sortBy.startsWith('first') ? 'first_name' : sortBy.startsWith('full') ? 'full_name' : 'surname';
    const comparison = String(left[field] || '').localeCompare(String(right[field] || ''), undefined, { numeric: true, sensitivity: 'base' });
    return sortBy.endsWith('desc') ? -comparison : comparison;
  });
  const availableRows = sortedRows.filter((student) => !excludeIds.includes(student.id));
  const allVisibleSelected = availableRows.length > 0 && availableRows.every((student) => selected.has(student.id));
  const toggleVisible = () => setSelected((previous) => {
    const next = new Set(previous);
    availableRows.forEach((student) => {
      if (allVisibleSelected) next.delete(student.id);
      else next.add(student.id);
    });
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name or ID" />
          <Select value={yearGroupId} onValueChange={setYearGroupId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All year groups</SelectItem>
              {yearGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={homeroomId} onValueChange={setHomeroomId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All homerooms</SelectItem>
              {homerooms.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger><SelectValue placeholder="Sort students" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="surname-asc">Last name A–Z</SelectItem>
              <SelectItem value="surname-desc">Last name Z–A</SelectItem>
              <SelectItem value="first-asc">First name A–Z</SelectItem>
              <SelectItem value="full-asc">Full name A–Z</SelectItem>
              <SelectItem value="id-asc">Student ID A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={toggleVisible} disabled={!availableRows.length}>
            {allVisibleSelected ? 'Deselect displayed' : `Select all ${availableRows.length} displayed`}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={!selected.size}>
            Clear selection
          </Button>
        </div>

        <div className="max-h-[44vh] overflow-y-auto rounded-xl border border-border">
          {loading && <p className="px-3 py-4 text-xs text-muted-foreground">Loading students…</p>}
          {!loading && rows.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">No students match those filters.</p>}
          {sortedRows.map((s) => {
            const already = excludeIds.includes(s.id);
            return (
              <label key={s.id} className={`flex items-center gap-2.5 border-b border-border/50 px-3 py-2 text-sm last:border-0 ${already ? 'opacity-50' : 'hover:bg-muted/50'}`}>
                <input type="checkbox" disabled={already} checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-border" />
                <span className="min-w-0 flex-1 truncate">{s.full_name}</span>
                <span className="text-[11px] text-muted-foreground">{s.homeroom_class_name || s.year_group_name || '—'}</span>
                {already && <span className="text-[10px] font-semibold uppercase text-muted-foreground">In class</span>}
              </label>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => confirming ? setConfirming(false) : onOpenChange(false)}>
              {confirming ? 'Back' : 'Cancel'}
            </Button>
            {confirming ? (
              <Button
                disabled={!selected.size}
                onClick={() => { onConfirm([...selected]); onOpenChange(false); }}
              >
                Confirm assignment
              </Button>
            ) : (
              <Button disabled={!selected.size} onClick={() => setConfirming(true)}>
                Review {selected.size || ''} student{selected.size === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </DialogFooter>
        {confirming && <p className="text-sm text-muted-foreground">Confirm assignment of {selected.size} selected student(s) to this class.</p>}
      </DialogContent>
    </Dialog>
  );
}
