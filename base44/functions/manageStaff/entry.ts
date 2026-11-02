import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor, isStaff, toList, audit, propagateMemberName } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, member, school } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!member) return Response.json({ error: 'You are not attached to a school yet' }, { status: 403 });
    if (!isStaff(member)) return Response.json({ error: 'Only administrators can manage staff accounts' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const svc = base44.asServiceRole;

    if (action === 'invite') {
      const email = (body.user_email || '').trim().toLowerCase();
      const fullName = (body.full_name || '').trim();
      const role = body.role || 'teacher';
      if (!email || !fullName) return Response.json({ error: 'Name and email are required' }, { status: 400 });
      if (!['teacher', 'it_admin', 'school_admin'].includes(role)) {
        return Response.json({ error: 'Unknown role' }, { status: 400 });
      }
      const dupe = toList(await svc.entities.SchoolMember.filter({ school_id: member.school_id, user_email: email }, { limit: 1 }));
      if (dupe.length) return Response.json({ error: 'A staff account already exists for that email' }, { status: 400 });

      const created = await svc.entities.SchoolMember.create({
        school_id: member.school_id,
        user_email: email,
        full_name: fullName,
        role,
        status: 'invited',
        username: body.username || email.split('@')[0],
        phone: body.phone || '',
        subject_specialisms: body.subject_specialisms || '',
      });

      let invited = true;
      let inviteError = '';
      try {
        await base44.users.inviteUser(email, 'user');
      } catch (e) {
        invited = false;
        inviteError = e.message || 'Invitation could not be sent';
        console.log('invite failed', inviteError);
      }

      await audit(base44, {
        schoolId: member.school_id, user, action: 'staff.invited', entityType: 'SchoolMember',
        entityId: created.id, summary: `Invited ${fullName} (${role})`,
      });
      return Response.json({ member: created, invited, invite_error: inviteError });
    }

    if (action === 'update') {
      const target = await svc.entities.SchoolMember.get(body.member_id).catch(() => null);
      if (!target || target.school_id !== member.school_id) return Response.json({ error: 'Staff member not found' }, { status: 404 });
      if (target.role === 'school_admin' && member.role !== 'school_admin') {
        return Response.json({ error: 'Only a school administrator can change an administrator account' }, { status: 403 });
      }
      if (target.id === member.id && body.role !== undefined && body.role !== target.role) {
        return Response.json({ error: 'You cannot change your own role. Ask another administrator.' }, { status: 400 });
      }
      if (target.id === member.id && body.status !== undefined && body.status !== target.status) {
        return Response.json({ error: 'You cannot change your own account status.' }, { status: 400 });
      }
      const patch = {};
      if (body.full_name !== undefined) {
        const name = String(body.full_name).trim().replace(/\s+/g, ' ');
        if (!name) return Response.json({ error: 'Enter the staff member\'s full name' }, { status: 400 });
        patch.full_name = name;
      }
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.username !== undefined) patch.username = body.username;
      if (body.subject_specialisms !== undefined) patch.subject_specialisms = body.subject_specialisms;
      if (body.status !== undefined) patch.status = body.status;
      if (body.role !== undefined) {
        if (body.role === 'school_admin' && member.role !== 'school_admin') {
          return Response.json({ error: 'Only a school administrator can grant that role' }, { status: 403 });
        }
        patch.role = body.role;
      }
      const updated = await svc.entities.SchoolMember.update(target.id, patch);
      if (patch.full_name && patch.full_name !== target.full_name) {
        await propagateMemberName(base44, { schoolId: member.school_id, memberId: target.id, fullName: patch.full_name });
      }
      if (patch.role || patch.status) {
        await svc.entities.User.update(target.user_id, {
          school_role: patch.role || target.role,
          ...(patch.status === 'inactive' ? { school_id: '', member_id: '' } : { school_id: member.school_id, member_id: target.id }),
        }).catch(() => null);
      }
      await audit(base44, {
        schoolId: member.school_id, user, action: 'staff.updated', entityType: 'SchoolMember',
        entityId: target.id, summary: `Updated ${target.full_name}: ${Object.keys(patch).join(', ')}`,
      });
      return Response.json({ member: updated });
    }

    if (action === 'resend_invite') {
      const target = await svc.entities.SchoolMember.get(body.member_id).catch(() => null);
      if (!target || target.school_id !== member.school_id) return Response.json({ error: 'Staff member not found' }, { status: 404 });
      try {
        await base44.users.inviteUser(target.user_email, 'user');
      } catch (e) {
        const msg = e.message || 'Invitation could not be sent';
        console.log('resend failed', msg);
        return Response.json({ error: `Invitation could not be sent: ${msg}` }, { status: 502 });
      }
      return Response.json({ ok: true });
    }

    if (action === 'remove') {
      if (member.role !== 'school_admin') return Response.json({ error: 'Only a school administrator can remove staff' }, { status: 403 });
      const target = await svc.entities.SchoolMember.get(body.member_id).catch(() => null);
      if (!target || target.school_id !== member.school_id) return Response.json({ error: 'Staff member not found' }, { status: 404 });
      const links = toList(await svc.entities.ClassTeacher.filter({ school_id: member.school_id, member_id: target.id }));
      await Promise.all(links.map((l) => svc.entities.ClassTeacher.delete(l.id)));
      await svc.entities.SchoolMember.delete(target.id);
      await audit(base44, {
        schoolId: member.school_id, user, action: 'staff.removed', entityType: 'SchoolMember',
        entityId: target.id, summary: `Removed ${target.full_name} and ${links.length} class assignments`,
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}