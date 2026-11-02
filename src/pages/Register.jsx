import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus, UserRound, Mail, Lock, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { safeReturnTo } from '@/lib/authReturnTo';

export default function Register() {
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    setupToken: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupStatus, setSetupStatus] = useState(null);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    base44.auth.setupStatus()
      .then(setSetupStatus)
      .catch((setupError) => setError(setupError.message))
      .finally(() => setCheckingSetup(false));
  }, []);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await base44.auth.createFirstAdmin({
        fullName: form.fullName,
        username: form.username,
        email: form.email,
        password: form.password,
        setupToken: form.setupToken,
      });
      window.location.assign(safeReturnTo());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={UserPlus}
      title="Set up ClassPulse"
      subtitle="Create the first administrator account for this deployment"
      footer={<>Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Log in</Link></>}
    >
      {checkingSetup && <p className="mb-4 text-sm text-muted-foreground">Checking administrator setup…</p>}
      {error && <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {!checkingSetup && setupStatus?.needs_setup && !setupStatus.setup_available && (
        <div className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Secure first-administrator setup has not been enabled for this deployment. Ask the deployment owner to configure it in Vercel.
        </div>
      )}
      {!checkingSetup && setupStatus && !setupStatus.needs_setup && (
        <div className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Initial setup is already complete. Sign in with your ClassPulse administrator account.
        </div>
      )}
      {!checkingSetup && setupStatus?.setup_available && (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full-name">Full name</Label>
          <Input id="full-name" autoComplete="name" autoFocus value={form.fullName} onChange={set('fullName')} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <div className="relative">
            <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="username" autoComplete="username" placeholder="e.g. admin" value={form.username} onChange={set('username')} className="pl-10" required minLength={3} maxLength={32} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email address <span className="text-muted-foreground">(optional)</span></Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={set('email')} className="pl-10" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} className="pl-10" required minLength={8} />
          </div>
          <p className="text-xs text-muted-foreground">Use at least 8 characters. Passwords are stored as salted hashes on the server.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} required minLength={8} />
        </div>
        {setupStatus.requires_setup_token && (
          <div className="space-y-2">
            <Label htmlFor="setup-token">One-time deployment setup key</Label>
            <Input
              id="setup-token"
              type="password"
              autoComplete="off"
              minLength={32}
              maxLength={256}
              value={form.setupToken}
              onChange={set('setupToken')}
              required
            />
            <p className="text-xs text-muted-foreground">
              Enter the key configured privately by the deployment owner. It is never stored in your account.
            </p>
          </div>
        )}
        <Button type="submit" className="h-12 w-full font-medium" disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting up…</> : 'Create administrator'}
        </Button>
      </form>
      )}
    </AuthLayout>
  );
}
