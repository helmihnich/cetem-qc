# PostgreSQL foundation

Set `DATABASE_URL` in the API process environment before starting database work. Keep credentials in the local/runtime secret store; `.env` files are ignored by git.

Apply pending migrations from `apps/api` with `pnpm db:migrate`. The runner applies sorted `NNNN_name.sql` files once, records their versions in `schema_migrations`, serializes concurrent runners with an advisory transaction lock, and runs each migration in a transaction. It does not synchronize schemas at API startup. Put feature-owned schema in a new migration when that feature introduces its persistent state.

Use `withTransaction` for multi-record authoritative commands. Keep each command's reads, revision checks, and writes on the supplied transaction client so they share one PostgreSQL transaction.
