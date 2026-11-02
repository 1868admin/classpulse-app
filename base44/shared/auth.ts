export function toList(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  return [];
}

export async function getActor(base44) {
  const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
  if (!user) return { user: null, member: null, school: null };
  const svc = base44.asServiceRole;
  let member = null;
  if (user.member_id) {
    member = await svc.entities.SchoolMember.get(user.member_id).catch(() => null);
  }
  if (!member) {
    const found = toList(await svc.entities.SchoolMember.filter({ user_email: user.email }, { limit: 5 }));
    member = found.find((m) => m.status !== 'inactive') || found[0] || null;
    if (member) {
      await svc.entities.SchoolMember.update(member.id, { user_id: user.id, status: 'active' });
      await svc.entities.User.update(user.id, {
        school_id: member.school_id,
        school_role: member.role,
        member_id: member.id,
      });
    }
  }
  let school = null;
  const schoolId = member?.school_id || user.school_id;
  if (schoolId) {
    school = await svc.entities.School.get(schoolId).catch(() => null);
  }
  return { user, member, school };
}

export function isStaff(member) {
  return !!member && (member.role === 'school_admin' || member.role === 'it_admin');
}

export function isSchoolAdmin(member) {
  return !!member && member.role === 'school_admin';
}

// Keeps denormalised teacher names (used for display only) in step with the staff record.
// Relationships themselves always stay keyed on member_id / user_id.
export async function propagateMemberName(base44, { schoolId, memberId, fullName }) {
  if (!schoolId || !memberId || !fullName) return { links: 0, sessions: 0 };
  const svc = base44.asServiceRole;
  const links = toList(await svc.entities.ClassTeacher.filter({ school_id: schoolId, member_id: memberId }, { limit: 300 }));
  const sessions = toList(await svc.entities.AttendanceSession.filter({ school_id: schoolId, member_id: memberId }, { limit: 300 }));
  await Promise.all([
    ...links.filter((l) => l.member_name !== fullName).map((l) => svc.entities.ClassTeacher.update(l.id, { member_name: fullName })),
    ...sessions.filter((s) => s.member_name !== fullName).map((s) => svc.entities.AttendanceSession.update(s.id, { member_name: fullName })),
  ]);
  return { links: links.length, sessions: sessions.length };
}

export async function audit(base44, { schoolId, user, action, entityType, entityId, summary }) {
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      school_id: schoolId,
      actor_name: user?.full_name || user?.email || 'Unknown',
      actor_email: user?.email || '',
      action,
      entity_type: entityType || '',
      entity_id: entityId || '',
      summary: summary || '',
    });
  } catch (e) {
    console.error('audit failed', e.message);
  }
}