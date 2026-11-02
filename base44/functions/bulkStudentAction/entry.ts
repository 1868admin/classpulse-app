import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor, isStaff, isSchoolAdmin, toList, audit } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, member } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!member) return Response.json({ error: 'No school membership' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : [];
    if (!ids.length) return Response.json({ error: 'No students selected' }, { status: 400 });
    const action = body.action;
    const p = body.payload || {};
    const svc = base44.asServiceRole;
    const schoolId = member.school_id;

    const students = toList(await svc.entities.Student.filter({ school_id: schoolId, id: { $in: ids } }, { limit: 500 }));
    if (!students.length) return Response.json({ error: 'No matching students' }, { status: 404 });

    if (action === 'assign_year_group') {
      if (!isStaff(member)) return Response.json({ error: 'Not permitted' }, { status: 403 });
      await svc.entities.Student.updateMany(
        { school_id: schoolId, id: { $in: ids } },
        { $set: { year_group_id: p.year_group_id || '', year_group_name: p.year_group_name || '' } },
      );
    } else if (action === 'assign_homeroom') {
      if (!isStaff(member)) return Response.json({ error: 'Not permitted' }, { status: 403 });
      await svc.entities.Student.updateMany(
        { school_id: schoolId, id: { $in: ids } },
        { $set: { homeroom_class_id: p.homeroom_class_id || '', homeroom_class_name: p.homeroom_class_name || '' } },
      );
      await svc.entities.ClassMembership.deleteMany({ school_id: schoolId, class_type: 'homeroom', student_id: { $in: ids } });
      if (p.homeroom_class_id) {
        await svc.entities.ClassMembership.bulkCreate(students.map((s) => ({
          school_id: schoolId,
          class_type: 'homeroom',
          class_id: p.homeroom_class_id,
          class_name: p.homeroom_class_name || '',
          student_id: s.id,
          student_name: s.full_name,
          student_id_no: s.student_id_no,
          year_group_id: p.year_group_id || s.year_group_id || '',
          year_group_name: p.year_group_name || s.year_group_name || '',
          academic_year_id: s.academic_year_id || '',
        })));
      }
      if (p.homeroom_class_id) {
        const total = await svc.entities.ClassMembership.count({ school_id: schoolId, class_type: 'homeroom', class_id: p.homeroom_class_id });
        await svc.entities.HomeroomClass.update(p.homeroom_class_id, { student_count: total });
      }
    } else if (action === 'change_status') {
      if (!isStaff(member)) return Response.json({ error: 'Not permitted' }, { status: 403 });
      await svc.entities.Student.updateMany(
        { school_id: schoolId, id: { $in: ids } },
        { $set: { status: p.status || 'active' } },
      );
    } else if (action === 'archive' || action === 'restore') {
      if (!isStaff(member)) return Response.json({ error: 'Not permitted' }, { status: 403 });
      await svc.entities.Student.updateMany(
        { school_id: schoolId, id: { $in: ids } },
        { $set: { archived: action === 'archive', status: action === 'archive' ? 'inactive' : 'active' } },
      );
    } else if (action === 'delete') {
      if (!isSchoolAdmin(member)) return Response.json({ error: 'Only a school administrator can delete students' }, { status: 403 });
      await svc.entities.Student.updateMany(
        { school_id: schoolId, id: { $in: ids } },
        { $set: { archived: true, status: 'inactive' } },
      );
    } else if (action === 'permanent_delete') {
      if (!isSchoolAdmin(member)) return Response.json({ error: 'Only a school administrator can permanently delete students' }, { status: 403 });
      await svc.entities.ClassMembership.deleteMany({ school_id: schoolId, student_id: { $in: ids } });
      await svc.entities.Student.deleteMany({ school_id: schoolId, id: { $in: ids } });
    } else if (action === 'add_to_class') {
      const cls = await svc.entities.SubjectClass.get(p.class_id).catch(() => null);
      if (!cls || cls.school_id !== schoolId) return Response.json({ error: 'Class not found' }, { status: 404 });
      if (!isStaff(member)) {
        const links = toList(await svc.entities.ClassTeacher.filter({ school_id: schoolId, class_id: cls.id, member_id: member.id }, { limit: 1 }));
        if (!links.length) return Response.json({ error: 'You are not a teacher of that class' }, { status: 403 });
      }
      const existing = toList(await svc.entities.ClassMembership.filter({ school_id: schoolId, class_id: p.class_id, student_id: { $in: ids } }, { limit: 500 }));
      const already = new Set(existing.map((m) => m.student_id));
      const toAdd = students.filter((s) => !already.has(s.id));
      if (toAdd.length) {
        await svc.entities.ClassMembership.bulkCreate(toAdd.map((s) => ({
          school_id: schoolId, class_type: 'subject', class_id: p.class_id, class_name: cls.name,
          student_id: s.id, student_name: s.full_name, student_id_no: s.student_id_no,
          year_group_id: s.year_group_id || '', year_group_name: s.year_group_name || '',
          academic_year_id: s.academic_year_id || '',
        })));
      }
      const total = await svc.entities.ClassMembership.count({ school_id: schoolId, class_id: p.class_id });
      await svc.entities.SubjectClass.update(p.class_id, { student_count: total });
    } else if (action === 'remove_from_class') {
      const cls = await svc.entities.SubjectClass.get(p.class_id).catch(() => null);
      if (!cls || cls.school_id !== schoolId) return Response.json({ error: 'Class not found' }, { status: 404 });
      if (!isStaff(member)) {
        const links = toList(await svc.entities.ClassTeacher.filter({ school_id: schoolId, class_id: cls.id, member_id: member.id }, { limit: 1 }));
        if (!links.length) return Response.json({ error: 'You are not a teacher of that class' }, { status: 403 });
      }
      for (const sid of ids) {
        await svc.entities.ClassMembership.deleteMany({ school_id: schoolId, class_type: 'subject', class_id: p.class_id, student_id: sid });
      }
      const total = await svc.entities.ClassMembership.count({ school_id: schoolId, class_id: p.class_id });
      await svc.entities.SubjectClass.update(p.class_id, { student_count: total });
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    await audit(base44, {
      schoolId, user, action: `students.${action}`, entityType: 'Student',
      entityId: ids.length === 1 ? ids[0] : '',
      summary: `${action.replace(/_/g, ' ')} for ${students.length} student(s)`,
    });

    return Response.json({ ok: true, affected: students.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}