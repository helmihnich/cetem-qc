# PostgreSQL foundation

Set `DATABASE_URL` in the API process environment before starting database work. Keep credentials in the local/runtime secret store; `.env` files are ignored by git.

Apply pending migrations from `apps/api` with `pnpm db:migrate`. The runner applies sorted `NNNN_name.sql` files once, records their versions in `schema_migrations`, serializes concurrent runners with an advisory transaction lock, and runs each migration in a transaction. It does not synchronize schemas at API startup. Put feature-owned schema in a new migration when that feature introduces its persistent state.

Use `withTransaction` for multi-record authoritative commands. Keep each command's reads, revision checks, and writes on the supplied transaction client so they share one PostgreSQL transaction.

## First Responsable bootstrap

Apply migrations first, then run `pnpm --filter @cetem-qc/api bootstrap:responsable` in a controlled operator terminal with `DATABASE_URL` supplied through the deployment secret environment. The command is single-use, prompts for the Responsable email and display name, generates a random temporary password, stores only its salted scrypt hash, and prints the credential once for manual handover. Do not redirect or capture terminal output; provide it directly to the named recipient through the approved out-of-band channel. There is no HTTP bootstrap endpoint.

## Server sessions

Apply the session migration before serving authentication traffic. Successful authentication returns an opaque bearer token once; PostgreSQL stores only its SHA-256 digest with an eight-hour server expiry. Authenticated server endpoints look up the unexpired session and current active account on every request. Replacing a temporary password revokes existing sessions and returns a newly issued session. `DELETE /api/v1/session` revokes the current session. This server expiry does not define or extend OD-01's separate mobile offline authorization window.

## Employee creation PostgreSQL integration test

The concurrent employee-creation acceptance test uses a real PostgreSQL database. It requires `CETEM_QC_TEST_DATABASE_URL` to point to a dedicated local database named `cetem_qc_test` or `cetem_qc_test_<suffix>`; it refuses other database names. The test creates a uniquely named temporary schema, applies migrations 0001 through 0005 there, verifies the case-insensitive unique index, runs two concurrent service calls, checks the committed account and team membership counts, then drops only its own schema.

For a local Docker setup, start PostgreSQL with `docker run --name cetem-qc-test-postgres --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cetem_qc_test -p 55432:5432 -d postgres:16`, then set `$env:CETEM_QC_TEST_DATABASE_URL='postgres://postgres:test@127.0.0.1:55432/cetem_qc_test'` in PowerShell. Run `pnpm --filter @cetem-qc/api exec tsx --test src/modules/team-access/employee-credentials.postgres.test.ts`. Stop the container with `docker stop cetem-qc-test-postgres` after the test.
