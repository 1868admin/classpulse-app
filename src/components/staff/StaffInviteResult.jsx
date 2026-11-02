import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { notifySuccess } from '@/lib/notify';

export default function StaffInviteResult({ open, onOpenChange, email, name, invited, inviteError }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/register`;
  const signIn = `${window.location.origin}/login`;

  const copy = async (value) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    notifySuccess('Copied', 'Access details copied to your clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Account created for {name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {invited
              ? <>An invitation email was sent to <span className="font-medium text-foreground">{email}</span>. If it doesn't arrive, pass the link below to them directly.</>
              : <>The invitation email could not be sent{inviteError ? ` (${inviteError})` : ''}. Pass the link below to them directly.</>}
          </p>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Their sign-in email</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate font-medium">{email}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(email)} aria-label="Copy email">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sign-in link</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs">{signIn}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(`Sign in at ${signIn} with ${email}`)} aria-label="Copy sign-in link">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
            <li>They open the link and register with <span className="font-medium text-foreground">{email}</span>.</li>
            <li>They enter the 6-digit code emailed to them, then choose their own password.</li>
            <li>ClassPulse attaches them to this school automatically — no extra setup.</li>
          </ol>

          <p className="text-[12px] text-muted-foreground">
            Passwords are chosen by each person and never stored in ClassPulse, so you can't set one for them.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => copy(`Join ClassPulse: ${link} — use ${email}`)}>
            Copy invite message
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}