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
    const { class_type, class_id, class_name, subject, date, day_name, period_number, session_label, records } = body;
    if (!class_id || !date || !session_label) return Response.json({ error: 'Class, date and session are required' }, { status: 400 });
    if (!Array.isArray(records)) return Response.json({ error: 'Attendance records are required' }, { status: 400 });

    const svc = base44.asServiceRole;

    if (!isStaff(member)) {
      const links = toList(await svc.entities.ClassTeacher.filter({ school_id: schoolId, class_id, member_id: member.id }, { limit: 1 }));
      if (!links.length) return Response.json({ error: 'You are not assigned to that class' }, { status: 403 });
    }

    const calendar = toList(await svc.entities.CalendarDate.filter({ school_id: schoolId, date }, { limit: 1 }))[0];
    if (calendar && calendar.day_type === 'no_school') {
      return Response.json({ error: 'That date is marked No School — attendance cannot be recorded' }, { status: 400 });
    }

    const sessionKey = [schoolId, class_type, class_id, date, session_label].join('|');
    const academicYear = toList(await svc.entities.AcademicYear.filter({ school_id: schoolId, is_current: true }, { limit: 1 }))[0] || null;

    const counted = records.reduce((acc, r) => {
      acc.total += 1;
      if (r.status === 'present') acc.present += 1;
      else if (r.status === 'absent') acc.absent += 1;
      else if (r.status === 'late') acc.late += 1;
      else if (r.status === 'excused') acc.excused += 1;
      return acc;
    }, { total: 0, present: 0, absent: 0, late: 0, excused: 0 });

    const payload = {
      school_id: schoolId,
      session_key: sessionKey,
      class_type: class_type || 'homeroom',
      class_id,
      class_name: class_name || '',
      subject: subject || '',
      date,
      day_name: day_name || '',
      period_number: Number(period_number) || 0,
      session_label,
      member_id: body.member_id || member.id,
      member_name: body.member_name || member.full_name,
      user_id: body.member_id && isStaff(member) ? body.user_id || user.id : user.id,
      academic_year_id: academicYear?.id || '',
      student_count: counted.total,
      present_count: counted.present,
      absent_count: counted.absent,
      late_count: counted.late,
      excused_count: counted.excused,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      last_edited_by: user.full_name || user.email,
    };

    const existing = toList(await svc.entities.AttendanceSession.filter({ school_id: schoolId, session_key: sessionKey }, { limit: 1 }))[0] || null;
    if (existing && !isStaff(member) && existing.user_id !== user.id) {
      return Response.json({ error: 'This register was submitted by another teacher' }, { status: 403 });
    }

    let session;
    if (existing) {
      session = await svc.entities.AttendanceSession.update(existing.id, payload);
    } else {
      session = await svc.entities.AttendanceSession.create(payload);
    }

    const prior = toList(await svc.entities.AttendanceRecord.filter({ school_id: schoolId, session_id: session.id }, { limit: 1000 }));
    const priorMap = new Map(prior.map((r) => [r.student_id, r]));
    const changes = [];
    const creates = [];
    for (const r of records.slice(0, 1000)) {
      if (!r.student_id) continue;
      const old = priorMap.get(r.student_id);
      if (!old) {
        creates.push({
          school_id: schoolId, session_id: session.id, class_type: payload.class_type, class_id, date,
          student_id: r.student_id, student_name: r.student_name || '', student_id_no: r.student_id_no || '',
          status: r.status || 'present', note: r.note || '', marked_by: user.full_name || user.email,
          academic_year_id: payload.academic_year_id,
        });
      } else if (old.status !== r.status || (old.note || '') !== (r.note || '')) {
        changes.push({ id: old.id, student_name: old.student_name, from: old.status, to: r.status || 'present' });
        await svc.entities.AttendanceRecord.update(old.id, { status: r.status || 'present', note: r.note || '' });
      }
    }
    if (creates.length) await svc.entities.AttendanceRecord.bulkCreate(creates);

    const presentIds = new Set(records.map((r) => r.student_id));
    const stale = prior.filter((p) => !presentIds.has(p.student_id));
    for (const s of stale) await svc.entities.AttendanceRecord.delete(s.id);

    await audit(base44, {
      schoolId, user,
      action: existing ? 'attendance.corrected' : 'attendance.submitted',
      entityType: 'AttendanceSession',
      entityId: session.id,
      summary: `${class_name || class_type} · ${date} · ${session_label}: ${counted.present} present, ${counted.absent} absent, ${counted.late} late${changes.length ? ` · ${changes.length} correction(s): ${changes.map((c) => `${c.student_name} ${c.from}→${c.to}`).join('; ')}` : ''}`,
    });

    return Response.json({ session, changed: changes.length, created: creates.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}