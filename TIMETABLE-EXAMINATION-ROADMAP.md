# Timetable and Examination Upgrade Roadmap

## Current architecture and baseline

- The application uses React and Vite with a custom Node.js API. Local records
  persist in SQLite; the hosted API persists records in PostgreSQL. Authentication
  and school membership are handled by the same-origin API.
- Entity definitions in `base44/entities/` are retained as schemas and reference
  material. Runtime records are stored in the `records` table as JSON, so additive
  entity properties do not require a destructive database migration.
- The lesson timetable stores one `TimetableEntry` per teacher. It supports
  academic-year selection, manual editing, CSV import, generation proposals,
  server-side teacher/class/room/availability conflict checks, approval,
  publishing, archival, and role-based access. Lesson timetables are not yet
  versioned.
- Current class rosters are represented by `ClassMembership`; `StudentEnrollment`
  records preserve enrolment history. Attendance records are separate and must
  remain independent of lesson and examination schedule archival.
- Examination schedules are stored separately from lesson timetables. They
  support draft, published, and archived states, and refer to an academic year,
  homeroom or subject class, date/time, and a free-text exam room.
- The application does not yet have an exam-room registry, independently
  managed examination capacities, or a timetable document archive. Invigilation
  assignments and staffing requirements are now stored separately from exam
  schedule records.

## Completed implementation

- Added server-side lesson timetable checks for simultaneous teacher, class, and
  room assignments, including clock-time overlaps even when period numbers
  differ.
- Applied lesson timetable checks to individual creates/edits, bulk writes, and
  imports. A failed replacement import leaves the existing timetable untouched.
- Associated new lesson entries without an academic-year value to the current
  academic year and treat legacy year-less entries as part of that year for
  conflict checks.
- Added API integration coverage for timetable conflicts, adjacent periods,
  bulk atomicity, and failed replacement imports.
- Added school-scoped, case-insensitive unique Teacher Numbers while retaining
  permanent membership IDs. Teacher subject specialisms are normalized as
  individual values, with existing comma-separated records kept readable.
- Added academic-year-linked teacher unavailability by timetable day and period.
  Timetable writes validate teacher/year school relationships, and referenced
  years cannot be deleted while timetable or availability records exist.
- Added role-gated Timetable Management views for master, teacher, class, room,
  import, and generation workflows. The generator builds an editable proposal,
  reports conflicts and unscheduled lessons, and publishes approved entries;
  teachers can only view their own published lesson timetable.
- Added an independent examination schedule record and management view. Only
  school administrators and IT administrators can create/edit drafts, publish,
  and archive. Teachers can read published schedules only, including through
  batch queries and direct-record requests.
- Validate examination academic-year and class ownership, year date boundaries,
  calendar dates, and start/end times on the server. Overlapping schedules are
  checked for the same class, case-insensitive room name, and actual active
  students shared through current `ClassMembership` records across subject and
  homeroom groups.
- Make examination draft saves, publication, and archival transactional and
  audited. Archival retains the examination record and leaves student
  memberships, attendance, and lesson timetable records unchanged. Integration
  tests cover lifecycle, authorization, conflicts, failed edits, and preservation.
- Added school-scoped invigilation assignment and staffing-requirement records
  without changing examination records or adding an exam-room registry.
- Added automatic allocation for published examinations. It checks teacher
  lesson timetables, unavailable periods and overlapping examination duties;
  uses actual `ClassTeacher` subject assignments as a soft restriction; and
  balances workload while allowing multiple supervisors and chief/assistant
  roles. Administrators can confirm duties, regenerate while retaining
  confirmed and still-eligible assignments, manually assign/reassign/remove
  staff, and publish assignments. Replaced and removed assignments remain
  historical records.
- Added administrator-approved lesson-conflict overrides requiring a reason,
  with assignment details and all administrative actions written to the audit
  log. Exam-duty overlaps and recorded teacher unavailability remain hard
  conflicts.
- Added administrative full, teacher, examination, room, and workload views,
  staffing warnings, per-examination staffing controls, and a teacher dashboard
  schedule with print and CSV download. Server-side reads restrict teachers to
  their own published assignments for published examinations; generic entity
  writes cannot bypass the audited workflows.
- Added integration coverage for allocation, lesson and examination conflicts,
  subject avoidance, workload fairness, staffing roles, manual changes,
  overrides, auditing, permissions, teacher data isolation, and regeneration.
- Added a PDF Generation and Distribution Centre (`server/documents.mjs`,
  `/api/documents/*`, "PDF Distribution Centre" tab in Timetable Management).
  PDFs are rendered server-side with jsPDF from the saved records at request
  time: master, teacher, class, room, examination, teacher supervision, and
  complete invigilation documents. Each carries the school name, academic year,
  generation date, a schedule version (latest update date, content revision
  hash and record count), page numbers, and wrapped (never clipped) cells, with
  repeating table headers and A4 landscape pagination.
- Administrators and IT administrators can choose the academic year and
  published-only or include-drafts scope (draft output is stamped "DRAFT - NOT
  PUBLISHED"), preview inline, download, print, regenerate, and bulk-export
  selected teachers/classes/rooms/school-wide documents as a ZIP with a
  `manifest.txt` (empty documents are skipped and listed; duplicate names get
  unique suffixes; 1000 documents maximum). Downloads are audit-logged.
- Teachers can download or print only their own published timetable and
  supervision schedule from the dashboard and timetable pages. The server
  forces published scope for teachers, rejects any other teacher id, document
  type, or ZIP request with 403, and returns 404 when nothing is published.
- Added `server/documents.test.mjs` (`npm run test:documents`) covering every
  document type, content accuracy, long names, draft exclusion, role/ID
  isolation, ZIP bundles, a large 480-lesson timetable, and regeneration.

## Remaining implementation plan

1. **Exam room inventory and capacity:** add active/inactive exam rooms and
   independent examination capacity validation. Invigilation continues to use
   the existing free-text examination room values; no exam-room registry was
   introduced in this phase.
2. **Versioned lesson timetable model:** persist draft/review/approved/published/
   archived versions and canonical lesson assignments while keeping existing
   timetable records readable and providing a safe compatibility path.
3. **Lesson timetable editor and generator:** add assignment locks and advanced
   regeneration, then preference optimization after hard-constraint validation.
4. **Lesson timetable import:** extend CSV import to explicit
   teacher/class/subject/room matching, duplicate detection, preview, and
   transactional confirmation. Add Excel parsing where required and supported.
5. **Document history:** add published lesson timetable snapshots and a
   stored document archive. PDFs are currently regenerated on demand and not
   stored, so a historical PDF cannot be reproduced after the schedule changes.
6. **Quality and release:** verify backend authorization, mobile layouts,
   existing student/class/attendance workflows, exports, SQLite and PostgreSQL
   behavior, and failure recovery before enabling broader publication.

## Known invigilation limitations

- Automatic generation defaults to two supervisors per examination room, with
  an administrator-configurable requirement from one to ten. Staffing is tied
  to each existing examination entry and its free-text room value; no room
  capacity or multi-room splitting is inferred.
- Administrators' unavailability selections apply to that generation run.
  Existing `TeacherAvailability` records are also respected.
- Published lesson conflicts use the date's `CalendarDate` day name. If that
  date is absent from the school calendar, the engine uses the weekday order
  in the school's day names; if it cannot resolve a day, it conservatively
  treats the teacher's published lessons for that academic year as conflicts.
- Subject avoidance uses current `ClassTeacher` links to subject classes.
  Teacher subject specialisms are intentionally not treated as actual teaching
  assignments. Where other eligible teachers are insufficient, subject
  teachers can be assigned and are flagged.
- A lesson-conflict override is available for a manual assignment or
  reassignment only. Examination-duty overlaps and recorded unavailability
  cannot be overridden.

## Known PDF distribution limitations

- Documents are not persisted; "regenerate" re-renders from current data. The
  schedule version identifies the data used but old versions are not retained.
- PDFs use built-in Latin fonts; characters outside Latin-1 (for example CJK or
  Arabic names) print as `?`. Embedding a Unicode font is future work.
- Bulk ZIPs are built synchronously in memory; very large schools may need a
  background job on serverless hosting (60 second function limit).
- Examination PDFs use the existing free-text room; there is no room registry.
- Print uses the browser's PDF viewer; behaviour varies slightly by browser.

## Recommended next step

Continue with the separate exam-room inventory and independent capacity
validation increment. Keep lesson timetable versioning and invigilation history
separate; neither rewrites existing lesson timetable entries, examination
records, student enrolments, or attendance.
