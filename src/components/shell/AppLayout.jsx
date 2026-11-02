import { Outlet, useLocation } from 'react-router-dom';
import { SchoolProvider, useSchool } from '@/context/SchoolContext';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import Onboarding from '@/pages/Onboarding';

function Gate() {
  const { loading, member, error, isPlatformAdmin } = useSchool();
  const { pathname } = useLocation();
  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="text-sm font-semibold">ClassPulse could not load your account</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message || 'Please refresh the page to try again.'}</p>
        <Button className="mt-4" size="sm" onClick={() => base44.auth.redirectToLogin(window.location.href)}>
          Sign in again
        </Button>
      </div>
    );
  }
  if (!member) {
    if (isPlatformAdmin && pathname === '/platform') return <Outlet />;
    return <Onboarding />;
  }
  return <Outlet />;
}

export default function AppLayout() {
  return (
    <SchoolProvider>
      <Gate />
    </SchoolProvider>
  );
}