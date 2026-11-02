import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';

export default function Welcome() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(token ? '' : 'This link is incomplete.');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    base44.auth.linkInfo(token).then(setInfo).catch((err) => setError(err.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await base44.auth.loginViaLink(token, password);
      window.location.replace('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const isReset = info?.mode === 'reset';

  return (
    <AuthLayout
      icon={KeyRound}
      title={info ? (isReset ? 'Reset your password' : `Welcome${info.full_name ? `, ${info.full_name.split(' ')[0]}` : ''}`) : 'ClassPulse'}
      subtitle={info ? 'Choose a password to continue' : 'Checking your link…'}
      footer={<Link to="/login" className="text-primary font-medium hover:underline">Go to log in</Link>}
    >
      {info ? (
        <form onSubmit={submit} className="space-y-3.5">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your username</p>
            <p className="mt-0.5 select-all font-mono text-sm font-semibold">{info.username}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Use this username and your new password to sign in from now on.</p>
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">New password</Label>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Confirm password</Label>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password and sign in'}</Button>
        </form>
      ) : (
        <p className="text-center text-sm text-foreground">{error || 'One moment…'}</p>
      )}
    </AuthLayout>
  );
}
