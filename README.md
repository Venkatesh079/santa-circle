# Santa Circle

A responsive Secret Santa app built with Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui components, and Supabase. It includes private matches, wishlists, organizer controls, theme switching, and optional snowfall.

## Run locally

Use Node.js 24 LTS and npm. From this directory, run

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). With both Supabase variables empty, choose **Open sample group** to try an exchange with four fictional participants, saved wishlists, and a pending invitation. You can also create an empty group.

Demo mode runs the production SQL migrations in a temporary, server-side PGlite database. Each browser session has its own demo identity. To test joining, copy an invitation link and open it in a separate browser profile or private window. Demo data disappears on server restart and is local to a single running instance. Use Supabase for persistent or multi-instance exchanges, including shared Vercel deployments.

## Connect Supabase

1. Create a Supabase project. In its SQL Editor, run the [initial schema](supabase/migrations/202611260001_santa_circle.sql), then the [budget validation and membership index migration](supabase/migrations/202611260002_budget_and_membership.sql). On an existing installation, apply only the pending migration. Historical budget amounts are preserved. Keep the Data API enabled with the public schema exposed. The private schema stays unexposed.
2. Under Authentication, enable the **Email** provider, allow new users to sign up, and keep email confirmation enabled. Configure an SMTP sender for delivery to your participants.
3. Update the **Magic Link** email template to include the one-time code. If your project has a separate **Confirm signup** template, include the code there as well. For example,

   ```html
   <p>Your Santa Circle sign-in code is <strong>{{ .Token }}</strong>.</p>
   ```

   Participants enter the code in the app, including first-time users arriving from an invitation. [Supabase email OTP documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless)
4. Copy the project URL and **publishable key** from the project's Connect or API Keys panel. Copy [.env.example](.env.example) to `.env.local` and set both values. Restart the development server.

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_project_key
   ```

The app uses the participant's authenticated session for database calls. Keep service-role keys, database passwords, and SMTP credentials out of the repository and the public environment variables. The app needs no service-role key. Supplying only one of the two variables is a configuration error.

## Publish on Vercel

1. Push this directory, including `package-lock.json` and `supabase/migrations`, to your Git provider. The repository root should contain `package.json`. If it is inside a larger repository, select this folder as Vercel's Root Directory.
2. In Vercel, select **Add New → Project**, import the repository, choose the **Next.js** preset, and select Node.js 24.x. Use the default install and build settings.
3. In project environment variables, set the two Supabase values above for Production. For preview deployments, set both values to a separate Supabase test project's credentials and apply the migration there. Previews with both values empty run the temporary demo. Production builds require both variables and validate the URL and public key before compilation. Enable Vercel’s system environment variables so the build can identify its deployment environment. [Vercel environment settings](https://vercel.com/docs/environment-variables/system-environment-variables)
4. Build a fresh production deployment with the production settings. Set the Supabase Authentication Site URL to your deployed HTTPS origin. Redeploy after changing Vercel environment variables.
5. Verify the hosted flow with three distinct email accounts. Create a group, share its invitation, join from two other sessions, save a wishlist, draw names, and open each private card. With only three participants, a mutual exclusion makes a complete draw impossible. Use at least four participants when testing a valid draw with a mutual exclusion.

Later pushes to the connected branch trigger new builds. [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)

## How exchanges work

- New groups use INR and start with an editable ₹800 budget.
- The organizer counts as a participant. Share the invitation link or 12-character code. Anyone with the code and a verified email may join before the draw.
- **Participants → Track invitation** records a guest email for the organizer. Share the link through your own messaging app. The pending entry clears when a participant joins with the same email.
- Organizers can edit settings, remove participants, and add mutual exclusions before drawing names. A draw supports 3–100 participants.
- PostgreSQL generates an assignment with randomized augmenting paths over allowed giver–recipient pairs. A circle row lock serializes membership changes and draws. An impossible draw rolls back. A successful draw saves every assignment and locks the group in one transaction.
- All exchange tables have Row Level Security enabled and reside in a restricted schema with default-deny direct access. Only the authenticated RPC exposes group operations. It checks verified identity, membership, and organizer permissions on the server. Organizer views include reveal status. The reveal operation returns only the current giver's recipient and their latest wishlist.
- Wishlists remain editable after drawing. Opening the card again shows updated ideas and preferences.

## Verification

GitHub Actions runs the lockfile install, tests, PostgreSQL concurrency check, type check, and production build on pushes and pull requests. The workflow uses local test data and build fixtures.

```sh
npm test
npm run typecheck
npm run build
npm start
```

For a local release build with fictional data, use `SANTA_CIRCLE_DEMO=true npm run build` and `SANTA_CIRCLE_DEMO=true npm start`. A Vercel Production deployment always requires Supabase.

Run `npm run test:postgres` with Python 3 and PostgreSQL's `initdb`, `pg_ctl` and `psql` on your PATH to verify competing draws on two database connections. The test creates a disposable database and uses an owner-only Unix socket directory. It does not connect to your Supabase project.

The configuration tests exercise production, preview, and local demo settings. The database integration tests run both migrations in PGlite and exercise role restrictions, duplicate joins, participant removal, failed-draw rollback, repeat-draw protection, exclusions, and private reveals. Email delivery and hosted deployment require your Supabase and Vercel accounts.
