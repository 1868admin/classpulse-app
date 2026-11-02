import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';

const SchoolContext = createContext(null);

export function SchoolProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, member: null, school: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const res = await base44.functions.invoke('sessionContext', {});
      const data = res.data || {};
      setState({ loading: false, user: data.user, member: data.member, school: data.school, error: null });
    } catch (e) {
      const status = e?.status || e?.response?.status;
      if (status === 401) {
        const signedIn = await base44.auth.isAuthenticated().catch(() => false);
        if (!signedIn) {
          base44.auth.redirectToLogin(window.location.href);
          return;
        }
      }
      setState({ loading: false, user: null, member: null, school: null, error: e });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => {
    const roles = [];
    if (state.member?.role) roles.push(state.member.role);
    if (state.user?.role === 'admin') roles.push('platform_admin');
    return {
      ...state,
      roles,
      isStaff: state.member?.role === 'school_admin' || state.member?.role === 'it_admin',
      isSchoolAdmin: state.member?.role === 'school_admin',
      isTeacher: state.member?.role === 'teacher',
      isPlatformAdmin: state.user?.role === 'admin',
      schoolId: state.member?.school_id || '',
      primaryRole: state.member?.role || (state.user?.role === 'admin' ? 'platform_admin' : 'teacher'),
      refresh,
    };
  }, [state, refresh]);

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error('useSchool must be used inside SchoolProvider');
  return ctx;
}