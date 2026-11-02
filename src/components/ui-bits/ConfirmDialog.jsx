import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, onConfirm, busy }) {
  const [working, setWorking] = useState(false);
  const run = async () => {
    setWorking(true);
    try { await onConfirm(); onOpenChange(false); } finally { setWorking(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-full ${destructive ? 'bg-red-100 text-red-600 dark:bg-red-950' : 'bg-blue-100 text-blue-600 dark:bg-blue-950'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="leading-relaxed">{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working || busy}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={run} disabled={working || busy}>
            {working || busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}