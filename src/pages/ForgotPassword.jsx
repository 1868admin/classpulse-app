import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';

export default function ForgotPassword() {
  return (
    <AuthLayout
      icon={KeyRound}
      title="Password help"
      subtitle="ClassPulse sign-in is managed locally on this computer"
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="mr-1 inline h-3 w-3" />Back to log in
        </Link>
      }
    >
      <p className="text-center text-sm text-foreground">
        Ask your school administrator to set a new password from Staff &amp; accounts. If you are the local administrator, use the password recovery command in the README.
      </p>
    </AuthLayout>
  );
}
