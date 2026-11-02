declare const base44: {
  entities: Record<string, {
    filter: (query: Record<string, unknown>, options: Record<string, unknown>) => Promise<{
      items?: Record<string, unknown>[];
      next_cursor?: string | null;
    } | Record<string, unknown>[]>;
  }>;
};

const entityNames = [
  'AcademicYear',
  'AttendanceRecord',
  'AttendanceSession',
  'AuditLog',
  'CalendarDate',
  'ClassMembership',
  'ClassTeacher',
  'HomeroomClass',
  'ImportJob',
  'School',
  'SchoolMember',
  'Student',
  'StudentEnrollment',
  'SubjectClass',
  'Term',
  'TimetableEntry',
  'YearGroup',
];

const entities: Record<string, Record<string, unknown>[]> = {};
for (const name of entityNames) {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let completed = false;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const result = await base44.entities[name].filter({}, { limit: 500, ...(cursor ? { cursor } : {}) });
    const items = Array.isArray(result) ? result : result.items || [];
    rows.push(...items);
    if (Array.isArray(result) || !result.next_cursor) {
      completed = true;
      break;
    }
    cursor = result.next_cursor;
  }
  if (!completed) throw new Error(`Export stopped before all pages of ${name} were read.`);
  entities[name] = rows;
}

console.log(JSON.stringify({ version: 1, exported_at: new Date().toISOString(), entities }));
