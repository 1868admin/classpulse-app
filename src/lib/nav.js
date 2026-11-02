import {
  LayoutDashboard, Users, GraduationCap, BookOpen, CalendarDays, ClipboardCheck,
  FileBarChart, Settings, School, CalendarClock, UploadCloud, UserCog,
} from 'lucide-react';

// Roles: platform_admin | school_admin | it_admin | teacher
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['platform_admin', 'school_admin', 'it_admin', 'teacher'] },
      { label: 'Schools', path: '/platform', icon: School, roles: ['platform_admin'] },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Students', path: '/students', icon: Users, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'Staff & accounts', path: '/staff', icon: UserCog, roles: ['school_admin', 'it_admin'] },
    ],
  },
  {
    label: 'Teaching',
    items: [
      { label: 'Homeroom classes', path: '/homerooms', icon: GraduationCap, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'Subject classes', path: '/subject-classes', icon: BookOpen, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'Timetable', path: '/timetable', icon: CalendarClock, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'Attendance', path: '/attendance', icon: ClipboardCheck, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'School calendar', path: '/calendar', icon: CalendarDays, roles: ['school_admin', 'it_admin', 'teacher'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Reports', path: '/reports', icon: FileBarChart, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'Academic years', path: '/academic', icon: UploadCloud, roles: ['school_admin', 'it_admin', 'teacher'] },
      { label: 'Settings', path: '/settings', icon: Settings, roles: ['school_admin', 'it_admin', 'teacher'] },
    ],
  },
];

export const ROLE_LABELS = {
  platform_admin: 'Platform administrator',
  school_admin: 'School administrator',
  it_admin: 'IT administrator',
  teacher: 'Teacher',
};

export function navForRoles(roles = []) {
  return NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((i) => i.roles.some((r) => roles.includes(r))) }))
    .filter((s) => s.items.length > 0);
}