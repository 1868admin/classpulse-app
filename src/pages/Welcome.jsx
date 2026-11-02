import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { base44 } from '@/api/base44Client';

export default function Welcome() {
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) { setError('This sign-in link is incomplete.'); return; }
    base44.auth.loginViaLink(token)
      .then(() => window.location.replace('/'))
      .catch((err) => setError(err.message));
  }, [params]);

  return (
    <AuthLayout
      icon={KeyRound}
      title="Signing you in"
      subtitle="One moment…"
      footer={error && (
        <Link to="/login" className="text-primary font-medium hover:underline">Go to log in</Link>
      )}
    >
      <p className="text-center text-sm text-foreground">
        {error || 'Checking your sign-in link…'}
      </p>
    </AuthLayout>
  );
}
