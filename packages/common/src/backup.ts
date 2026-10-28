import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";

const PG_DUMP = process.env.PG_DUMP_PATH || "pg_dump";
const PG_RESTORE = process.env.PG_RESTORE_PATH || "pg_restore";
// Set to the Postgres container name (e.g. "fii-billing-postgres-1") to run
// pg_dump/pg_restore INSIDE the container — guarantees a version match with the
// server, so a host client of a different major version doesn't matter.
const DOCKER = process.env.PGDUMP_DOCKER_CONTAINER;

interface Conn { user: string; pass: string; db: string; schema?: string; url: string }

/**
 * Parse a Prisma/libpq URL. Prisma adds params libpq rejects (`?schema=public`,
 * `connection_limit`, …); we strip them for the host client and pull `schema`
 * out so pg_dump can take it as a `--schema` flag.
 */
function parseConn(raw: string): Conn {
  const u = new URL(raw);
  const schema = u.searchParams.get("schema") ?? undefined;
  const allowed = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout", "application_name"]);
  for (const key of [...u.searchParams.keys()]) if (!allowed.has(key)) u.searchParams.delete(key);
  return {
    user: decodeURIComponent(u.username) || "postgres",
    pass: decodeURIComponent(u.password),
    db: u.pathname.replace(/^\//, "") || "postgres",
    schema,
    url: u.toString(),
  };
}

function run(cmd: string, args: string[], opts: { inFile?: string; outFile?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdin = opts.inFile ? "pipe" : "ignore";
    const stdout = opts.outFile ? "pipe" : "ignore";
    const p = spawn(cmd, args, { stdio: [stdin, stdout, "pipe"], env: { ...process.env, ...opts.env } });
    let err = "";
    p.stderr?.on("data", (d: Buffer) => { err += d.toString(); });
    if (opts.outFile && p.stdout) p.stdout.pipe(createWriteStream(opts.outFile));
    if (opts.inFile && p.stdin) createReadStream(opts.inFile).pipe(p.stdin);
    p.on("error", (e) => reject(new Error(`Cannot run "${cmd}" — install PostgreSQL client tools, set PG_DUMP_PATH, or set PGDUMP_DOCKER_CONTAINER (${e.message})`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 500)}`))));
  });
}

/** pg_dump the database (custom format) to `outFile`. */
export function runPgDump(outFile: string, rawUrl = process.env.DATABASE_URL): Promise<void> {
  if (!rawUrl) return Promise.reject(new Error("DATABASE_URL is not set"));
  const c = parseConn(rawUrl);
  const schemaArgs = c.schema ? ["--schema", c.schema] : [];
  if (DOCKER) {
    return run("docker",
      ["exec", "-e", "PGPASSWORD", DOCKER, "pg_dump", "-U", c.user, "-d", c.db, "-h", "127.0.0.1", "--format=custom", "--no-owner", "--no-privileges", ...schemaArgs],
      { outFile, env: { PGPASSWORD: c.pass } });
  }
  return run(PG_DUMP, ["--format=custom", "--no-owner", "--no-privileges", ...schemaArgs, "--file", outFile, c.url]);
}

/** pg_restore a custom-format dump, dropping existing objects first (single txn). */
export function runPgRestore(inFile: string, rawUrl = process.env.DATABASE_URL): Promise<void> {
  if (!rawUrl) return Promise.reject(new Error("DATABASE_URL is not set"));
  const c = parseConn(rawUrl);
  const opts = ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--single-transaction"];
  if (DOCKER) {
    return run("docker",
      ["exec", "-i", "-e", "PGPASSWORD", DOCKER, "pg_restore", "-U", c.user, "-d", c.db, "-h", "127.0.0.1", ...opts],
      { inFile, env: { PGPASSWORD: c.pass } });
  }
  return run(PG_RESTORE, [...opts, "--dbname", c.url, inFile]);
}

/** True when the dump tool is callable — surfaced to the UI to disable the button. */
export async function pgDumpAvailable(): Promise<boolean> {
  try {
    if (DOCKER) await run("docker", ["exec", DOCKER, "pg_dump", "--version"]);
    else await run(PG_DUMP, ["--version"]);
    return true;
  } catch { return false; }
}
