import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Lock, UserRound, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';

export default function RecoverAdmin() {
  const [form, setForm] = useState({
    recoveryToken: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
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
      await base44.auth.recoverInitialAdmin({
        recoveryToken: form.recoveryToken,
        username: form.username,
        password: form.password,
      });
      setComplete(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={KeyRound}
      title="Recover administrator access"
      subtitle="Set a new username and password for the existing administrator account"
      footer={<>Return to <Link to="/login" className="font-medium text-primary hover:underline">sign in</Link></>}
    >
      {complete ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-muted p-3 text-sm">
            Administrator credentials updated. Sign in with the new username and password.
          </p>
          <Button asChild className="h-12 w-full font-medium">
            <Link to="/login">Go to sign in</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            The recovery key has been used. Remove ADMIN_RECOVERY_TOKEN from Vercel and redeploy.
          </p>
        </div>
      ) : (
        <>
          {error && <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-token">One-time recovery key</Label>
              <Input
                id="recovery-token"
                type="password"
                autoComplete="off"
                minLength={32}
                maxLength={256}
                value={form.recoveryToken}
                onChange={set('recoveryToken')}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">New username</Label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="username"
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  value={form.username}
                  onChange={set('username')}
                  className="pl-10"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={256}
                  value={form.password}
                  onChange={set('password')}
                  className="pl-10"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={256}
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                required
              />
            </div>
            <Button type="submit" className="h-12 w-full font-medium" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating access…</> : 'Reset administrator access'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
