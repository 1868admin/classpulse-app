import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { toList, audit } from '../../shared/auth.ts';

const DEFAULT_DAY_NAMES = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
const DEFAULT_PERIODS = [
  { number: 1, start: '08:30', end: '09:20' },
  { number: 2, start: '09:20', end: '10:10' },
  { number: 3, start: '10:30', end: '11:20' },
  { number: 4, start: '11:20', end: '12:10' },
  { number: 5, start: '13:10', end: '14:00' },
  { number: 6, start: '14:00', end: '14:50' },
];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return Response.json({ error: 'School name is required' }, { status: 400 });

    const svc = base44.asServiceRole;
    const existingSchools = await svc.entities.School.count();
    const isPlatformAdmin = user.role === 'admin';
    if (!isPlatformAdmin && existingSchools > 0) {
      return Response.json({ error: 'Only a platform administrator can register a school' }, { status: 403 });
    }

    const timetableDays = Number(body.timetable_days) > 0 ? Number(body.timetable_days) : 5;
    const dayNames = Array.isArray(body.day_names) && body.day_names.length ? body.day_names.slice(0, timetableDays) : DEFAULT_DAY_NAMES.slice(0, timetableDays);
    const periods = Array.isArray(body.periods) && body.periods.length ? body.periods : DEFAULT_PERIODS;
    const yearLabel = body.academic_year_label || '2026/2027';

    const school = await svc.entities.School.create({
      name,
      code: (body.code || name.slice(0, 6)).toUpperCase(),
      address: body.address || '',
      phone: body.phone || '',
      email: body.email || '',
      principal_name: body.principal_name || '',
      status: 'active',
      timetable_days: timetableDays,
      day_names: dayNames,
      periods,
      academic_year_label: yearLabel,
      setup_complete: false,
    });

    const academicYear = await svc.entities.AcademicYear.create({
      school_id: school.id,
      name: yearLabel,
      start_date: body.year_start || '',
      end_date: body.year_end || '',
      is_current: true,
    });

    const groupNames = Array.isArray(body.year_group_names) && body.year_group_names.length
      ? body.year_group_names
      : ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5'];

    await svc.entities.YearGroup.bulkCreate(
      groupNames.map((g, i) => ({ school_id: school.id, name: g, level: i + 1, next_level: i + 2 })),
    );

    await svc.entities.Term.bulkCreate([
      { school_id: school.id, academic_year_id: academicYear.id, academic_year_name: yearLabel, name: 'Term 1', is_current: true },
      { school_id: school.id, academic_year_id: academicYear.id, academic_year_name: yearLabel, name: 'Term 2', is_current: false },
      { school_id: school.id, academic_year_id: academicYear.id, academic_year_name: yearLabel, name: 'Term 3', is_current: false },
    ]);

    const existing = toList(await svc.entities.SchoolMember.filter({ school_id: school.id, user_email: user.email }, { limit: 1 }));
    let member = existing[0];
    if (!member) {
      member = await svc.entities.SchoolMember.create({
        school_id: school.id,
        user_id: user.id,
        user_email: user.email,
        full_name: user.full_name || user.email,
        role: 'school_admin',
        status: 'active',
        username: (user.email || '').split('@')[0],
      });
    }
    if (!user.school_id) {
      await svc.entities.User.update(user.id, { school_id: school.id, school_role: 'school_admin', member_id: member.id });
    }

    await audit(base44, {
      schoolId: school.id,
      user,
      action: 'school.created',
      entityType: 'School',
      entityId: school.id,
      summary: `Registered school ${name}`,
    });

    return Response.json({ school, member, academicYear });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}