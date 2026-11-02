import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ClassOrderControls({ label, canMoveUp, canMoveDown, onMove }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" aria-label={`Reorder ${label}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={`Move ${label} up`}
        title={`Move ${label} up`}
        disabled={!canMoveUp}
        onClick={() => onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={`Move ${label} down`}
        title={`Move ${label} down`}
        disabled={!canMoveDown}
        onClick={() => onMove(1)}
      >
        <ArrowDown />
      </Button>
    </div>
  );
}
