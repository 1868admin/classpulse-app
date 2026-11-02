import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor, toList } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const svc = base44.asServiceRole;

    if (body.list) {
      const members = toList(await svc.entities.SchoolMember.filter({ user_email: user.email }, { limit: 20 }));
      const schools = [];
      for (const m of members) {
        const s = await svc.entities.School.get(m.school_id).catch(() => null);
        if (s) schools.push({ id: s.id, name: s.name, role: m.role, member_id: m.id });
      }
      return Response.json({ schools });
    }

    const schoolId = body.school_id;
    if (!schoolId) return Response.json({ error: 'school_id is required' }, { status: 400 });
    const member = toList(await svc.entities.SchoolMember.filter({ user_email: user.email, school_id: schoolId }, { limit: 1 }))[0];
    if (!member) return Response.json({ error: 'You are not a member of that school' }, { status: 403 });
    await svc.entities.User.update(user.id, { school_id: schoolId, school_role: member.role, member_id: member.id });
    await svc.entities.SchoolMember.update(member.id, { user_id: user.id });
    return Response.json({ ok: true, school_id: schoolId, role: member.role });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}