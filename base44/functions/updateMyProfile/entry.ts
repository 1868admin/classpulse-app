import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor, propagateMemberName, audit } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, member } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!member) return Response.json({ error: 'You are not attached to a school yet' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const patch = {};

    if (body.full_name !== undefined) {
      const name = String(body.full_name).trim().replace(/\s+/g, ' ');
      if (!name) return Response.json({ error: 'Enter your full name' }, { status: 400 });
      if (name.length > 80) return Response.json({ error: 'Names must be 80 characters or fewer' }, { status: 400 });
      patch.full_name = name;
    }
    if (body.phone !== undefined) patch.phone = String(body.phone).trim().slice(0, 40);
    if (body.subject_specialisms !== undefined) {
      patch.subject_specialisms = String(body.subject_specialisms).trim().slice(0, 160);
    }

    if (!Object.keys(patch).length) return Response.json({ error: 'Nothing to save' }, { status: 400 });

    const updated = await base44.asServiceRole.entities.SchoolMember.update(member.id, patch);

    let propagated = { links: 0, sessions: 0 };
    if (patch.full_name && patch.full_name !== member.full_name) {
      propagated = await propagateMemberName(base44, {
        schoolId: member.school_id,
        memberId: member.id,
        fullName: patch.full_name,
      });
      await audit(base44, {
        schoolId: member.school_id,
        user,
        action: 'profile.name_changed',
        entityType: 'SchoolMember',
        entityId: member.id,
        summary: `Display name changed from ${member.full_name} to ${patch.full_name}`,
      });
    }

    // Authentication credentials (email / password) are never touched here.
    return Response.json({ member: updated, propagated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}