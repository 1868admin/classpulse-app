import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';

export default function ResetPassword() {
  return (
    <AuthLayout
      icon={KeyRound}
      title="Password reset"
      subtitle="Password changes are managed locally"
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="mr-1 inline h-3 w-3" />Back to log in
        </Link>
      }
    >
      <p className="text-center text-sm text-foreground">
        Ask your school administrator to set a new password from Staff &amp; accounts. For the local administrator, follow the recovery instructions in README.
      </p>
    </AuthLayout>
  );
}
