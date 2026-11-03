# Timetable and Examination Upgrade Roadmap

## Architecture review

- The application uses React and Vite with a custom Node.js API. Local records
  persist in SQLite; the hosted API persists records in PostgreSQL. Authentication
  and school membership are handled by the same-origin API.
- Entity definitions in `base44/entities/` are retained as schemas and reference
  material. Runtime records are stored in the `records` table as JSON, so additive
  entity properties do not require a destructive database migration.
- The existing timetable editor stores one `TimetableEntry` per teacher, with
  academic-year, class, and room references. It supports manual entry and CSV
  import. Teacher numbers, structured subject specialisms, and academic-year
  unavailability are now available.
- The current data model does not yet provide timetable versions/publication,
  room inventories, examination schedules, invigilation assignments, or a
  timetable document archive.
- Authentication and staff roles are enforced by the API, but the timetable
  workflow is not yet a versioned approval/publishing process. Existing
  attendance records are independent records and must remain so.

## Completed in this phase

- Added server-side timetable checks for simultaneous teacher, class, and room
  assignments, including clock-time overlaps even when period numbers differ.
- Applied the checks to individual creates/edits, bulk writes, and timetable
  imports. A failed replacement import leaves the existing timetable untouched.
- Associated new entries without an academic-year value to the current academic
  year and treat legacy year-less entries as part of that year for conflict checks.
- Added API integration coverage for conflicts, adjacent periods, bulk atomicity,
  and failed replacement imports.
- Added school-scoped, case-insensitive unique Teacher Numbers while retaining
  permanent membership IDs. Teacher subject specialisms are now normalized as
  individual values, with existing comma-separated records kept readable.
- Added academic-year-linked teacher unavailability by timetable day and period.
  Timetable writes reject unavailable slots, timetable views and imports can
  target an academic year, and replacing one year's schedule preserves other
  years. Timetable and availability writes validate teacher/year school
  relationships, and referenced years cannot be deleted.

## Remaining implementation plan

1. **Versioned timetable model:** introduce draft/review/approved/published/
   archived versions and canonical lesson assignments; keep existing timetable
   records readable and provide a safe backfill/compatibility path.
2. **Timetable editor and generator:** add class/room/teacher views, editable
   assignments, locks and regeneration; implement hard-constraint validation
   before adding preference optimization or publication.
3. **Import workflow:** extend CSV import to explicit teacher/class/subject/room
   matching, duplicate detection, preview, and transactional confirmation. Add
   Excel parsing only where the current workbook dependency supports the required
   import behavior.
4. **Teacher distribution and PDFs:** add the teacher-facing timetable, published
   snapshots, branded individual/master PDFs, and historical document access.
5. **Examination scheduling:** add examination periods, class/student conflict
   checks, room capacity and availability, overrides, and approved timetable views.
6. **Invigilation:** implement eligibility and subject restrictions, teaching and
   examination-duty conflicts, workload balancing, recorded exceptions, and the
   teacher supervision dashboard.
7. **Quality and release:** verify backend authorization, mobile layouts, existing
   student/class/attendance workflows, exports, SQLite and PostgreSQL behavior,
   and failure recovery before enabling publication.

## Recommended next step

Implement versioned timetable records and canonical lesson/teacher assignments.
Resolve the canonical lesson/teacher assignment data contract before adding
generation, examination, or invigilation interfaces; this avoids duplicating the
current per-teacher entry model and preserves imported history.
