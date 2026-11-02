import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, member, school } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    return Response.json({
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        school_id: member?.school_id || user.school_id || '',
      },
      member: member
        ? { id: member.id, role: member.role, status: member.status, full_name: member.full_name, school_id: member.school_id }
        : null,
      school: school
        ? { id: school.id, name: school.name, code: school.code, academic_year_label: school.academic_year_label, timetable_days: school.timetable_days, day_names: school.day_names, periods: school.periods, status: school.status }
        : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}