import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor, isStaff, toList, audit } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, member } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!member) return Response.json({ error: 'No school membership' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const schoolId = member.school_id;
    const ids = Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : [];
    if (!ids.length) return Response.json({ error: 'Select at least one student' }, { status: 400 });

    const svc = base44.asServiceRole;
    const target = body.to || {};

    if (!isStaff(member)) {
      // Homeroom teachers may promote their own homeroom students only.
      const homeroomLinks = toList(await svc.entities.ClassTeacher.filter({ school_id: schoolId, member_id: member.id, class_type: 'homeroom' }, { limit: 200 }));
      const allowed = new Set(homeroomLinks.map((l) => l.class_id));
      const students = toList(await svc.entities.Student.filter({ school_id: schoolId, id: { $in: ids } }, { limit: 500 }));
      const outside = students.filter((s) => !allowed.has(s.homeroom_class_id));
      if (outside.length) return Response.json({ error: 'You can only promote students in your homeroom classes' }, { status: 403 });
    }

    const students = toList(await svc.entities.Student.filter({ school_id: schoolId, id: { $in: ids } }, { limit: 500 }));
    const currentYear = toList(await svc.entities.AcademicYear.filter({ school_id: schoolId, is_current: true }, { limit: 1 }))[0] || null;

    // One history row per student per academic year — re-running a promotion must not duplicate it.
    const existingHistory = await toList(await svc.entities.StudentEnrollment.filter(
      { school_id: schoolId, student_id: { $in: students.map((s) => s.id) } },
      { limit: 1000 },
    ));
    const recorded = new Set(existingHistory.map((h) => `${h.student_id}|${h.academic_year_id || ''}`));
    const history = students
      .map((s) => ({
        key: `${s.id}|${s.academic_year_id || currentYear?.id || ''}`,
        row: {
          school_id: schoolId,
          student_id: s.id,
          student_name: s.full_name,
          student_id_no: s.student_id_no,
          academic_year_id: s.academic_year_id || currentYear?.id || '',
          academic_year_name: s.academic_year_name || currentYear?.name || '',
          year_group_id: s.year_group_id || '',
          year_group_name: s.year_group_name || '',
          homeroom_class_id: s.homeroom_class_id || '',
          homeroom_class_name: s.homeroom_class_name || '',
          status: 'completed',
          outcome: body.outcome || 'promoted',
        },
      }))
      .filter((h) => !recorded.has(h.key))
      .map((h) => h.row);
    if (history.length) await svc.entities.StudentEnrollment.bulkCreate(history);

    for (const s of students) {
      const patch = {};
      if (target.academic_year_id) { patch.academic_year_id = target.academic_year_id; patch.academic_year_name = target.academic_year_name || ''; }
      if (body.outcome === 'repeating') {
        patch.status = 'active';
      } else {
        if (target.year_group_id) { patch.year_group_id = target.year_group_id; patch.year_group_name = target.year_group_name || ''; }
        if (target.homeroom_class_id !== undefined) {
          patch.homeroom_class_id = target.homeroom_class_id || '';
          patch.homeroom_class_name = target.homeroom_class_name || '';
        }
        if (body.outcome === 'graduated') patch.status = 'graduated';
        if (body.outcome === 'transferred') patch.status = 'transferred';
      }
      await svc.entities.Student.update(s.id, patch);
      await svc.entities.ClassMembership.deleteMany({ school_id: schoolId, class_type: 'homeroom', student_id: s.id });
      if (patch.homeroom_class_id) {
        await svc.entities.ClassMembership.create({
          school_id: schoolId, class_type: 'homeroom', class_id: patch.homeroom_class_id,
          class_name: patch.homeroom_class_name || '', student_id: s.id, student_name: s.full_name,
          student_id_no: s.student_id_no, year_group_id: patch.year_group_id || s.year_group_id || '',
          year_group_name: patch.year_group_name || s.year_group_name || '',
          academic_year_id: patch.academic_year_id || s.academic_year_id || '',
        });
      }
    }

    if (body.approve) {
      const pending = toList(await svc.entities.StudentEnrollment.filter(
        { school_id: schoolId, student_id: { $in: students.map((s) => s.id) }, status: 'pending' },
        { limit: 500 },
      ));
      await Promise.all(pending.map((p) => svc.entities.StudentEnrollment.update(p.id, { status: 'approved' })));
    }

    await audit(base44, {
      schoolId, user, action: 'students.promoted', entityType: 'Student',
      summary: `Promoted ${students.length} student(s) to ${target.year_group_name || 'the next year group'} (${body.outcome || 'promoted'})`,
    });

    return Response.json({ promoted: students.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}