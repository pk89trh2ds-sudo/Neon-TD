// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is globbed from. That is what makes the auth schema safe to
 * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:
 * a database that already has `0001_auth.sql` will not re-run it.
 *
 * Neither applier descends into subdirectories, so `migrations/auth/*.sql` is
 * out of scope for both until it is copied up.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}

/**
 * Error codes meaning "the database could not be reached at all", as opposed to
 * "it was reached and rejected a migration". Only the first kind may be skipped
 * at build time. ENOTFOUND is what a *paused* Supabase free-tier project looks
 * like on its direct host (`db.<ref>.supabase.co` is removed from DNS until the
 * project is restored); EAI_AGAIN is a transient DNS failure; 57P03 is
 * "the database system is starting up" while a restore is in progress.
 */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "57P03",
]);

/**
 * Messages with no `code` that mean the same thing: node-postgres's own
 * `connectionTimeoutMillis` expiry, and Supavisor (the Supabase pooler host)
 * answering for a paused or deleted project.
 */
const UNREACHABLE_MESSAGES = [
  /timeout expired/i,
  /connection timeout/i,
  /tenant or user not found/i,
];

/**
 * True when `err` means the database is unreachable (down, paused, starting,
 * or not routable from here) rather than a real migration/SQL/auth failure.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isUnreachableDbError(err) {
  if (!err || typeof err !== "object") return false;
  const { code, message } = /** @type {{ code?: unknown, message?: unknown }} */ (err);
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
  return typeof message === "string" && UNREACHABLE_MESSAGES.some((re) => re.test(message));
}

/**
 * If `databaseUrl` points at a Supabase project's *direct* host
 * (`db.<ref>.supabase.co`), an actionable explanation of why it can't be
 * reached from Vercel; otherwise null.
 *
 * That host publishes only an IPv6 (AAAA) record, and Vercel's build machines
 * and serverless functions are IPv4-only, so every connection fails with
 * ENOTFOUND / ENETUNREACH even while the project is up. It is a configuration
 * problem with a configuration fix — the Supavisor pooler string, which is
 * reachable over IPv4 — so say that instead of a bare DNS error.
 * @param {string | undefined} databaseUrl
 * @returns {string | null}
 */
export function supabaseDirectHostHint(databaseUrl) {
  let host;
  try {
    host = new URL(String(databaseUrl)).hostname;
  } catch {
    return null;
  }
  const match = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(host);
  if (!match) return null;
  return (
    `DATABASE_URL points at Supabase's direct host ${host}, which is IPv6-only — ` +
    "Vercel is IPv4-only and can never reach it. Set DATABASE_URL to the " +
    "Transaction pooler string instead (Supabase dashboard → Connect → " +
    `Transaction pooler: postgresql://postgres.${match[1]}:<password>@<region>.pooler.supabase.com:6543/postgres).`
  );
}
