# ClassPulse

ClassPulse runs on this computer with a local SQLite database and local
username/password accounts. The app does not use Base44 for sign-in or normal
operation. Base44 is needed only if you choose to export your existing hosted
school data once.

## Shared hosting with Vercel and Supabase

The project also supports a shared Vercel deployment backed by Supabase
PostgreSQL. Local use remains SQLite unless `DATABASE_URL` is set. In the
hosted deployment, the server handles authentication and all school-data
access; the browser does not connect directly to Supabase or use Supabase Auth.

1. Connect the project to a **private** Git repository in Vercel. Do not commit
   `.env` files, SQLite databases, or exported school data.
2. In Vercel, add `DATABASE_URL` as a server-only **Production** environment
   variable. Use the Supabase **transaction-mode connection pooler** URL
   (port `6543`) with SSL. ClassPulse preserves PostgreSQL's standard SSL-mode
   behavior for the Node.js driver. Do not prefix it with `VITE_`, expose it to
   client code, or paste it into chat.
3. Keep the Supabase project’s Data API disabled. The backend creates its
   PostgreSQL tables on first use and applies unique database constraints for
   student IDs, Birth Paper Numbers, class membership, and attendance sessions.
4. Vercel builds the frontend and serves the same-origin API from the
   `api/` function. `vercel.json` includes the entity definitions required by
   the server. The Vercel runtime requires Node.js 22.12 or newer.

### Secure first administrator and school setup

The public deployment must not allow an untrusted visitor to claim its first
administrator account. Before opening the setup form:

1. Generate a random one-time key locally, for example with
   `openssl rand -hex 32`.
2. Add it to Vercel as the server-only Production environment variable
   `INITIAL_ADMIN_SETUP_TOKEN`. Never use a `VITE_` prefix or paste the key
   into chat or source control.
3. Redeploy, open `/register` on the deployed site, and create the first
   ClassPulse administrator using that key. The server verifies the key and
   only allows the first account to be created once. Passwords are stored as
   salted hashes, and the session cookie is HTTP-only and secure.
4. After the account is created, remove `INITIAL_ADMIN_SETUP_TOKEN` from
   Vercel and redeploy. The first-admin endpoint remains closed because the
   account already exists.
5. Sign in with the username and password created in ClassPulse. An email
   address is optional. A Supabase Auth user is separate and does not
   automatically become a ClassPulse account.
6. Create the school in the setup screen; the new administrator is linked to
   it as `school_admin`. If existing school records have already been migrated,
   open **Schools** and choose the existing school to create the administrator
   membership instead. Add teachers and other school staff from **Staff &
   accounts**.

### Recovering hosted administrator access

If the hosted administrator password is lost, set a temporary random
`ADMIN_RECOVERY_TOKEN` in Vercel Production (at least 32 characters), redeploy,
then open `/recover-admin` and enter the key with the new administrator
username and password. Recovery only updates the existing administrator
account, revokes its active sessions, and permanently consumes that key.
Remove `ADMIN_RECOVERY_TOKEN` from Vercel and redeploy immediately after
recovery. This does not reset or delete school data.

If `DATABASE_URL` is missing, the API cannot start. If the first-admin key is
missing on Vercel, the setup page stays unavailable rather than opening
registration to the public. Do not enable direct browser access to student
tables to work around deployment configuration.

For local development against the shared database, create a private
`.env.local` file containing `DATABASE_URL`, then run:

```bash
node --env-file=.env.local scripts/dev.mjs
```

This uses the shared cloud records instead of `data/classpulse.sqlite`. Avoid
using this mode for routine development if the live school data should not be
changed.

### Moving the existing local database

Do not run the migration while teachers are using the local app. First set
`DATABASE_URL` in a private environment file, then run a dry run:

```bash
node --env-file=.env.local server/migrate-sqlite-to-postgres.mjs
```

The dry run validates the SQLite database and requires an empty PostgreSQL
target; it creates the PostgreSQL schema but uploads no records. Resolve any
reported duplicates before proceeding. After reviewing the result, stop the
local app and run:

```bash
node --env-file=.env.local server/migrate-sqlite-to-postgres.mjs --apply
```

The migration creates a protected local SQLite backup before transferring
records, accounts, and student-ID sequences in one PostgreSQL transaction.
Password hashes are retained; existing login sessions are not, so users must
sign in again. The script refuses to import into a non-empty target. Never
delete the local database or backup until the hosted app and migrated records
have been checked. The Supabase project is currently on its Free plan; verify
its backup, recovery, and usage limits before storing live student records.

## Requirements

- Node.js 22.12 or newer
- npm

## Start the local app

From the project directory:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally
`http://127.0.0.1:5173`). Keep the terminal open while using ClassPulse. The
development command starts both the local API and frontend.

On the first local visit, choose **Create the first administrator** from the
login page to set a name, username, optional email, and password. Passwords
must be at least 8 characters. After signing in, create a school or open an
imported school. School administrators create staff accounts from the Staff
page using a full name, username, and password; email is optional and no
invitation email is sent. The initial password works immediately. Share it
privately with the staff member, and avoid reusing one password across accounts.

To run the built app instead:

```bash
npm run build
npm start
```

Then open `http://127.0.0.1:4400`.

## Local data and passwords

- The database is stored in `data/classpulse.sqlite`. It is created
  automatically and excluded from Git.
- The server listens on `127.0.0.1` by default, so it is available only on this
  computer. Do not expose it to a network without adding and reviewing
  appropriate security controls.
- Passwords are stored as salted hashes. The local database is **not encrypted
  at rest**. Enable FileVault and protect any backups because school records
  can contain sensitive student information.
- To back up the database, stop ClassPulse and copy the `data` directory to a
  secure location. Keep backups private and test restoring them.
- To reset an account password, stop ClassPulse and run
  `npm run reset-password -- <username>`. Follow the terminal prompts.
- Use **Log out** before leaving the computer unattended. Local accounts are
  managed by the school administrator; email invitations and password-reset
  emails are unavailable offline.

## Attendance and student workflows

- Attendance registers use the date selected by the user; timetable entries are
  references and do not make a date ineligible. Consecutive periods for the
  same class, subject, and teacher can share one register.
- The calendar links directly to the selected date's attendance registers and
  indicates attendance progress for assigned classes.
- Student lists support combined filters and sorting. Student imports accept
  `.xlsx`, `.xls`, and `.csv`; missing IDs are allocated from the graduating
  cohort and homeroom sequence.
- Birth Paper Numbers are optional and restricted to school administrators and
  IT administrators. They are excluded from general student lists and class
  exports; protect the local database and backups as sensitive records.
- Class pages provide sorted PDF and Excel rosters. Academic-year promotion
  records each student's prior enrolment and requires a review-and-confirm step.
- Teachers can add students to any active homeroom in their school. The
  homeroom/year group determines the permanent student ID pattern and the
  server allocates its next sequence number. Teachers can promote students
  from their assigned homeroom and subject classes; administrators retain year
  and term management.
- Homeroom, subject-class, and attendance lists have per-user up/down ordering
  controls. The preference is saved in that user's browser and does not change
  class or student records.
- The dashboard summarizes homeroom attendance by class and month. School
  administrators can set the monthly student attendance alert threshold in
  **Settings → School details**. Homeroom dashboards also show the number of
  boys and girls marked present for each class. Teachers' attendance analytics
  are restricted to classes assigned to them.

## One-time migration from Base44

The app itself does not need Base44 or Deno. Exporting hosted data requires
access to the existing Base44 app, an authenticated Base44 CLI, and Deno.
Export files contain sensitive school records; keep them private and remove
them after import.

1. Install the Base44 CLI and Deno if needed, then authenticate the CLI from
   this project directory:

   ```bash
   base44 login
   ```

2. Export the existing entities to the git-ignored `base44-export.json` file:

   ```bash
   base44 exec --privileged < scripts/export-base44-data.ts > base44-export.json
   ```

   The export reads records only; it does not change the hosted app.

3. Stop the local app, then import the file:

   ```bash
   npm run import:base44 -- base44-export.json
   ```

   The importer creates a database backup before making changes and reports
   aggregate record counts, not student details.

4. Start ClassPulse and create the first local administrator. Use the same
   email as the existing Base44 account when possible so the account connects
   to its imported school membership. If it does not match, open **Schools**
   to connect the local administrator to an imported school.

5. Imported staff profiles are rebuilt from their school memberships and do
   not retain Base44 passwords. A school administrator must edit each staff
   account and set a local username/password before that staff member can sign
   in. Remove the export file after confirming the migration:

   ```bash
   rm base44-export.json
   ```

## Development

Frontend files are in `src/`; the local API and SQLite implementation are in
`server/`. The retained `base44/` entity schemas and function sources are
reference material and support the one-time export; the running app uses the
local server.

```bash
npm run lint
npm run build
```
