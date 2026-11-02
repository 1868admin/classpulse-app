import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { notifySuccess } from '@/lib/notify';

export default function StaffLinkDialog({ link, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const url = `${window.location.origin}/welcome?token=${encodeURIComponent(link.token)}`;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    notifySuccess('Copied', 'Sign-in link copied to your clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{link.mode === 'reset' ? 'Password reset link' : 'Account setup link'} for {link.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="break-all font-mono text-xs">{url}</p>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {link.mode === 'reset'
              ? `${link.name} will see their username (${link.username}) and choose a new password. Their old password stops working once they do.`
              : `${link.name} will see their username (${link.username}) and choose their own password.`}
            {' '}The link works once and expires on {new Date(link.expires_at).toLocaleString()}. Send it privately.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Done</Button>
          <Button type="button" onClick={copy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
