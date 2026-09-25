import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isMigrationFile,
  isUnreachableDbError,
  migrationName,
  pendingMigrations,
} from "./migration-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

const AUTH_MIGRATION = "0001_auth.sql";

/**
 * The auth-on copy of the Better Auth schema and its source, or null when the
 * app has not turned sign-in on (the shipped state).
 */
function authSchemaCopy(root) {
  const copy = join(root, "migrations", AUTH_MIGRATION);
  const source = join(root, "migrations/auth", AUTH_MIGRATION);
  if (!existsSync(copy) || !existsSync(source)) return null;
  return { copy: readFileSync(copy, "utf8"), source: readFileSync(source, "utf8") };
}

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/auth/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  // The auth-on path copies migrations/auth/0001_auth.sql into the globbed
  // directory; a database that already has it must not run it twice.
  assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped (readdir also yields the auth/ directory)", () => {
  assert.equal(isMigrationFile("auth"), false);
  assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
});

test("the auth schema is copied up now that sign-in is on", () => {
  // Sign-in on (this app): "Turning sign-in on" copies migrations/auth/0001_auth.sql
  // up to migrations/0001_auth.sql, so it IS in scope for the top-level glob —
  // the auth/ subdirectory itself still stays out of scope (non-recursive read).
  // Assert membership, not an exact list: this app's own migrations
  // (0002_*.sql, ...) grow over time and aren't this test's concern.
  const migrationsDir = join(projectRoot(), "migrations");
  const pending = pendingMigrations(readdirSync(migrationsDir), []);
  assert.ok(
    pending.some((m) => m.name === AUTH_MIGRATION && m.path === AUTH_MIGRATION),
    "expected 0001_auth.sql among the pending migrations",
  );
  assert.ok(readdirSync(join(migrationsDir, "auth")).includes("0001_auth.sql"));
});

test("this workspace's auth schema copy is byte-identical to its source", () => {
  // An edited copy diverges silently: basename keying skips it on a database
  // that already ran the original, and applies it on a fresh PGLite preview.
  const pair = authSchemaCopy(projectRoot());
  if (pair === null) return; // sign-in off — nothing has been copied up
  assert.equal(
    pair.copy,
    pair.source,
    "migrations/0001_auth.sql has been edited — it must stay a verbatim copy of migrations/auth/0001_auth.sql",
  );
});

test("the copy check reads both files and catches an edit", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-schema-"));
  mkdirSync(join(root, "migrations/auth"), { recursive: true });
  writeFileSync(join(root, "migrations/auth", AUTH_MIGRATION), "create table t ();\n");
  assert.equal(authSchemaCopy(root), null);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t ();\n");
  const same = authSchemaCopy(root);
  assert.equal(same.copy, same.source);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t (x int);\n");
  const drifted = authSchemaCopy(root);
  assert.notEqual(drifted.copy, drifted.source);
});

test("an unreachable or paused database is skippable at build time", () => {
  // A paused Supabase project's direct host drops out of DNS — this is the
  // error that used to fail every production build while the DB slept.
  const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND db.x.supabase.co"), {
    code: "ENOTFOUND",
  });
  assert.equal(isUnreachableDbError(enotfound), true);
  for (const code of [
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "57P03",
  ]) {
    assert.equal(isUnreachableDbError({ code, message: "" }), true, code);
  }
  // node-postgres connectionTimeoutMillis, and the Supabase pooler for a paused project.
  assert.equal(isUnreachableDbError(new Error("timeout expired")), true);
  assert.equal(
    isUnreachableDbError(new Error("Connection terminated due to connection timeout")),
    true,
  );
  assert.equal(isUnreachableDbError({ code: "XX000", message: "Tenant or user not found" }), true);
});

test("real migration and auth failures are not skippable", () => {
  assert.equal(
    isUnreachableDbError({ code: "42601", message: 'syntax error at or near "tabel"' }),
    false,
  );
  assert.equal(
    isUnreachableDbError({ code: "28P01", message: "password authentication failed" }),
    false,
  );
  assert.equal(isUnreachableDbError(new Error("boom")), false);
  assert.equal(isUnreachableDbError(undefined), false);
  assert.equal(isUnreachableDbError("ENOTFOUND"), false);
});
