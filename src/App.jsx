import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
// Add page imports here
import AppLayout from '@/components/shell/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Students from '@/pages/Students';
import Staff from '@/pages/Staff';
import Homerooms from '@/pages/Homerooms';
import SubjectClasses from '@/pages/SubjectClasses';
import ClassDetail from '@/pages/ClassDetail';
import Timetable from '@/pages/Timetable';
import Calendar from '@/pages/Calendar';
import Attendance from '@/pages/Attendance';
import AttendanceRegister from '@/pages/AttendanceRegister';
import Reports from '@/pages/Reports';
import Academic from '@/pages/Academic';
import Settings from '@/pages/Settings';
import Platform from '@/pages/Platform';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const { pathname } = useLocation();
  const isAuthPath = AUTH_PATHS.includes(pathname);

  if (!isAuthPath && (isLoadingPublicSettings || isLoadingAuth)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthPath && authError) {
    if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    } else {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-lg font-bold">Local ClassPulse server unavailable</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Start the app with <code>npm run dev</code>, then reload this page.
          </p>
        </div>
      );
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/students" element={<Students />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/homerooms" element={<Homerooms />} />
        <Route path="/homerooms/:id" element={<ClassDetail type="homeroom" />} />
        <Route path="/subject-classes" element={<SubjectClasses />} />
        <Route path="/subject-classes/:id" element={<ClassDetail type="subject" />} />
        <Route path="/timetable" element={<Timetable />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/attendance/register" element={<AttendanceRegister />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/academic" element={<Academic />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/platform" element={<Platform />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App