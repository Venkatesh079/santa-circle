# Santa Circle

A Secret Santa for one team, built with Next.js and TypeScript. Participants create a name/password account, save a wishlist, and reveal their recipient after the administrator enables the draw.

## Run locally

Use **Node.js 24 LTS**.

```sh
npm ci
npm run dev
```

If macOS reports `EMFILE: too many open files`, use `WATCHPACK_POLLING=true npm run dev`.

Open http://localhost:3000. No Supabase account, Docker, or separate database service is required.

The development administrator is:

- Name: `admin`
- Password: `local-santa-admin`

For custom credentials, copy `.env.example` to `.env.local`, set `ADMIN_NAME` and `ADMIN_PASSWORD`, and restart the server. The admin is provisioned automatically and cannot participate, save a wishlist, or reveal matches. The admin name must be separate from the approved participant names. Changing its configured credentials and restarting updates the admin and revokes its previous sessions.

## Test the flow

1. Open `/signup` and create at least two participant accounts with different approved full names. Sign out between accounts, or use separate browser profiles. Participants are enrolled automatically; there are no groups or invitation codes.
2. Save a wishlist for each participant. **Sign out** is in the top-right header on every signed-in page and always asks for confirmation. If a participant has unsaved wishlist changes, they can save and sign out, discard and sign out, or cancel to continue editing. Drafts are shared with the header so these choices also work after navigating to another page. A failed save keeps their changes and leaves them signed in. The **Draw** button is disabled initially, and early draw requests are also rejected on the server.
3. Sign in with the administrator account at `/signin`. Check the participant list, make sure everyone has saved their wishlist, and press **Enable draw**, then confirm. This closes registration, locks all wishlists, and creates all assignments together. At least two participants are required.
4. Sign in as each participant, or press **Refresh status** in an already open dashboard. Press **Draw** to see that account’s recipient and their wishlist. Repeating the draw returns the same recipient. Only the signed-in giver can retrieve their match through the app; the admin dashboard never displays assignments.
5. Check **My wishlist** after the draw starts: saved wishes remain visible, but editing is unavailable. Wishlist save requests from older open pages are also rejected by the server.

Approved names live only in the database’s `approved_people` table. A new installation starts with an empty approved list; the administrator adds people through the dashboard. The repository contains no personal roster, and tests use generated synthetic names. Existing database rosters are preserved. Before the draw, the administrator can add an Aria Profile name or delete a person from **Approved people**, with a confirmation prompt for either action. Added people can register themselves; deleting a registered person permanently removes their account, wishlist, recovery hint, sessions, and reset links as well as their roster entry. Changes persist across restarts. After the draw starts, adding and deleting people is blocked on the server and the controls are hidden. Signup matches the full name without regard to capitalization and tolerates surrounding/repeated whitespace. It saves the canonical spelling from the roster. A unique database constraint permits only one account per approved person, including simultaneous signup requests. Participants use their full Aria Profile name and password to sign in, with the same case and whitespace normalization. No email address is collected or stored.

On an existing database, accounts whose full names already match are linked automatically. Abbreviated or ambiguous names require the administrator to select the correct approved name under **Match existing accounts**. New signup and enabling a new draw are blocked until that review is complete. Existing account IDs, passwords, wishlists, and assignments are preserved; an already enabled draw stays enabled. The local database is migrated to name-based sign-in, removing the old address column.

## Database and passwords

The app uses **Supabase PostgreSQL** when `DATABASE_URL` is configured, including on Vercel. Without it, local development uses a persistent **SQLite** file at `data/santa.sqlite`. The file is created automatically on first signup-page or database access and persists across app restarts. It stores accounts, bcrypt password hashes, wishlists, sessions, the draw status, and assignments. Local database files and `.env.local` are ignored by Git. The current PostgreSQL schema is `supabase/migrations/202611270001_santa_app.sql`. Earlier migrations describe a different app and are not required for this version. Existing SQLite and historical Supabase users/data are not automatically migrated.

Passwords use bcrypt with a random salt and cost 12; plaintext passwords are never stored. Passwords must contain at least 8 characters and fit bcrypt’s 72-byte UTF-8 limit. Sessions use random tokens in HttpOnly, SameSite cookies; only SHA-256 token hashes are stored in the database. Sessions expire after seven days and are revoked on sign-out. Login attempts are limited to ten per account name within 15 minutes, with that counter cleared after successful login. A broader limit of 200 authentication attempts per IP within 15 minutes protects against name-spraying without pooling everyone into the ten-attempt account limit. A recovery question and answer are optional at signup. Leave both blank to skip them; if either is provided, both are required. Recovery answers are normalized for case and whitespace and stored only as bcrypt hashes with cost 12. Participants can open **Reset password** from sign-in and enter their Aria Profile name, the question they selected, their answer, and a new password with confirmation. The old password is not required. Participants without a recovery hint are directed to contact their administrator for a one-time reset link. Reset requests are throttled by name and IP. A successful reset revokes all sessions for that participant. Recovery hints can only be set during registration. There is no option to add or change them afterward. The administrator can press **Generate reset link** beside a participant in the admin dashboard, copy the private link, and share it directly with that person. It works even if the participant skipped recovery setup. The participant sees their name prefilled and read-only, then chooses and confirms their own new password. The admin never enters the password. Links expire after 30 minutes, and generating another link for the same participant invalidates the previous one. Opening or previewing a link does not consume it. Only a successful password reset consumes it, atomically with updating the bcrypt password hash and signing out that participant's existing sessions. Failed validation or a failed database transaction leaves the link available until expiry. Only token hashes are stored in the database; the browser fragment carries the token so it is not sent in request URLs or referrers. Both reset paths preserve the account, wishlist, recovery hint, and draw assignments. A recovery-answer reset also invalidates outstanding reset links.

Set `APP_URL` to your app's public origin before generating links in production; it must use HTTPS (HTTP loopback is allowed for local testing). In development it defaults to `http://127.0.0.1:3000`. A localhost link only works on the same computer. The admin must share links privately with the correct participant. Administrator credentials remain managed through server configuration.

Enabling the draw uses a SQLite write transaction to freeze registration and save a complete random derangement: everyone gives once, everyone receives once, and nobody gifts themselves. Cryptographic random numbers shuffle participants; shuffles containing self-matches are retried. All assignments are saved atomically, and the administrator is always excluded.

For essential changes during the actual event, the administrator can choose **Review draw reset** while the draw is active. Three confirmation steps require acknowledging that every match becomes invalid, confirming that participants have been informed, entering a reason and the current administrator password, then typing `RESET DRAW` exactly and accepting a final warning. The app sends no notifications: the administrator must contact participants directly, including asking them to disregard any recipient already viewed or gifts already planned. Already displayed names cannot be retracted.

The server verifies the administrator session, rate limits password checks, and issues a single-use approval that expires after five minutes and is bound to that session and draw revision. A new approval replaces the previous one; logout, changed credentials, expiry, a reset, or a new draw makes old approval unusable. Before clearing anything, the server must create a private SQLite backup in the database directory’s `backups/` folder (directory mode 0700, file mode 0600). Backup failure leaves the draw unchanged. Clearing assignments, reopening setup, consuming approvals, and recording the administrator, reason, time, participant count, and backup path happen together in one transaction. Accounts, saved wishlists, recovery details, sessions, and password-reset links are preserved. The administrator can then change the roster and enable a new draw; people must refresh/sign in and draw again. Backups contain sensitive account data and assignments and are never served through the UI; restoration is a deliberate server-side maintenance operation.

To start a fresh **local test**, stop the server and move the `data` directory outside the project as a backup, then restart. This starts a new exchange with an empty database. Do not do this to a real team’s active exchange.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The tests exercise password hashing, duplicate/racing registrations, admin restrictions, disabled draws, complete and stable assignments, rollback, sessions, persistent storage, throttling, approved-name validation, simultaneous claims on a single roster name, legacy roster review, recovery-answer validation and hashing, password resets, and competing draws in separate processes. GitHub Actions runs tests, a production build, and type checking.

## Deploy on Vercel with Supabase

1. Create or select a Supabase project. In its SQL Editor, run **only** `supabase/migrations/202611270001_santa_app.sql` for this version of the app. Run it once. It creates a separate private `santa_app` schema; it does not modify the historical `santa_private` schema. Runtime requests do not create or migrate tables.
2. In Supabase **Connect**, select the **Transaction pooler** connection string (port 6543). Use the actual database password, URL-encoded when necessary. Use TLS with certificate verification (`sslmode=verify-full`, or configure Supabase's CA certificate if your project requires it). This driver uses unnamed parameterized queries and transaction-scoped settings, compatible with transaction pooling. See [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. In Vercel project environment variables, set:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Private PostgreSQL transaction pooler URI from step 2 |
   | `ADMIN_PASSWORD` | A private password, 8 to 72 UTF-8 bytes |
   | `ADMIN_NAME` | Optional; defaults to `admin` |
   | `APP_URL` | Your public HTTPS origin |

   Enable the variables for Production (and Preview if needed). Use a separate database/project for preview deployments so testing cannot alter the real exchange. Do not expose `DATABASE_URL` with a `NEXT_PUBLIC_` prefix. No Supabase anonymous or service-role API key is needed: access is through the server-side database connection, and the app retains its own name/password login.
4. Redeploy. Sign in as administrator, add approved participant names, then let participants register. The administrator is initialized on the first database request. A missing schema, invalid connection string, or missing password fails without falling back to temporary storage.

The PostgreSQL backend preserves shared accounts, sessions, rate limits, wishlists, and assignments across Vercel instances. Transactions serialize exchange changes by locking the exchange row. Before a protected draw reset, it saves a private JSON recovery snapshot in `santa_app.draw_backups` in the same transaction as the reset and its audit record. Snapshot failure rolls back the reset. The `backup_path` audit value is a reference such as `postgres:draw_backups/<id>`, not a file path. These archives contain sensitive account data and matches; they have no browser API access. Configure database backups separately in Supabase. Restoring an archive requires deliberate database maintenance; no automatic restore tool is included.

This setup starts with an empty hosted exchange. It does not copy `data/santa.sqlite` or users from the historical Supabase app. Back up any existing exchange before planning a separate data migration.

## Local SQLite hosting

Without `DATABASE_URL`, a Node.js server with a persistent writable disk can continue using SQLite. Set `ADMIN_PASSWORD`, optionally `ADMIN_NAME`, and `DATABASE_PATH` pointing to that disk. Use HTTPS in production. Vercel explicitly requires `DATABASE_URL` and never falls back to SQLite or `/tmp`.

```sh
npm run build
ADMIN_PASSWORD='replace-with-a-private-password' npm start
```

Back up SQLite with the server stopped, including WAL/SHM sidecar files. Keep the database outside publicly served directories. Configure proxies to replace `X-Forwarded-For` for authentication throttling.

## PostgreSQL integration verification

Apply the current migration to a **disposable** PostgreSQL database first (the migration expects Supabase's `anon` and `authenticated` roles). Then run:

```sh
TEST_DATABASE_URL='postgresql://localhost/disposable_santa_test' node --experimental-strip-types --test tests/postgres.test.mjs
```

This test clears all current `santa_app` data in that database. It covers competing registrations/draws/resets, private snapshots and rollback, cross-instance sessions, password recovery, and browser-role access denial. Normal `npm test` skips this integration test when `TEST_DATABASE_URL` is unset.
