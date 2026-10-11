#!/usr/bin/env node
// One-off helper: move all data from one account to another.
//
// Renaming an account means updating two things, because the account name is
// both the database owner key and the on-disk directory name:
//   1. uploads/<from>/          -> uploads/<to>/
//   2. uploads/clipboard/<from>/ -> uploads/clipboard/<to>/
//   3. userId = '<from>'         -> '<to>'  in Clipboard / ClipboardImage / FileMetadata
//
// Files are moved before the database is updated (the database is the source of
// truth for on-disk paths, so it must never point at a file that is not there
// yet). Re-running is safe: already-moved files are skipped.
//
// Dry run (default) prints the plan without changing anything:
//   node server/scripts/renameAccount.mjs default alice
// Apply:
//   node server/scripts/renameAccount.mjs default alice --apply
//
// Override locations with env vars if your layout differs:
//   DB_PATH, UPLOADS_DIR
//
// Requires Node 22+ for the built-in node:sqlite module.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite prints an experimental-feature warning when it is first loaded, so
// the filter has to be installed before the dynamic import below.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const message = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (message.includes('SQLite is an experimental feature')) return;
  emitWarning(warning, ...rest);
};

const { DatabaseSync } = await import('node:sqlite');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const RESERVED_USERNAMES = new Set(['.', '..', '__legacy__']);
const TABLES = ['Clipboard', 'ClipboardImage', 'FileMetadata'];

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const dbPath = process.env.DB_PATH || path.join(serverDir, 'prisma', 'data', 'prod.db');
const uploadsRoot = process.env.UPLOADS_DIR || path.join(serverDir, 'uploads');
const clipboardRoot = path.join(uploadsRoot, 'clipboard');

const [from, to, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');

const die = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

if (!from || !to) {
  die('usage: renameAccount.mjs <from-account> <to-account> [--apply]');
}
if (from === to) die('source and target accounts are identical');
if (!USERNAME_PATTERN.test(to) || RESERVED_USERNAMES.has(to)) {
  die(`"${to}" is not a valid account name (USERS would reject it)`);
}
if (!fs.existsSync(dbPath)) {
  die(`database not found at ${dbPath} (set DB_PATH to override)`);
}

const dirIsNonEmpty = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0;

const planMoves = (sourceDir, targetDir) => {
  if (!fs.existsSync(sourceDir)) return [];
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => ({ from: path.join(sourceDir, e.name), to: path.join(targetDir, e.name) }));
};

const db = new DatabaseSync(dbPath);
const countFor = (table, userId) =>
  db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE userId = ?`).get(userId).n;

const counts = Object.fromEntries(TABLES.map((t) => [t, countFor(t, from)]));
const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

const moves = [
  ...planMoves(path.join(uploadsRoot, from), path.join(uploadsRoot, to)),
  ...planMoves(path.join(clipboardRoot, from), path.join(clipboardRoot, to)),
];

// Already done, or nothing was ever owned by the source account.
if (totalRows === 0 && moves.length === 0) {
  console.log(`nothing to do: no rows and no files are owned by "${from}"`);
  db.close();
  process.exit(0);
}

// Refuse to silently merge into an account that already holds data.
const blocked = [];
if (dirIsNonEmpty(path.join(uploadsRoot, to))) blocked.push(path.join(uploadsRoot, to));
if (dirIsNonEmpty(path.join(clipboardRoot, to))) blocked.push(path.join(clipboardRoot, to));
if (blocked.length > 0) {
  db.close();
  die(`target account already has files, refusing to merge: ${blocked.join(', ')}`);
}

console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — moving account "${from}" -> "${to}"`);
console.log(`  database : ${dbPath}`);
console.log(`  uploads  : ${uploadsRoot}`);
console.log(`  rows     : ${TABLES.map((t) => `${t}=${counts[t]}`).join(', ')}`);
console.log(`  files    : ${moves.length}`);

if (!apply) {
  console.log('\nNo changes made. Re-run with --apply to perform the move.');
  db.close();
  process.exit(0);
}

let moved = 0;
let skipped = 0;
for (const move of moves) {
  if (fs.existsSync(move.to)) {
    console.warn(`  ! target exists, skipped: ${move.to}`);
    skipped += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(move.to), { recursive: true });
  fs.renameSync(move.from, move.to);
  moved += 1;
}

db.exec('BEGIN');
try {
  for (const table of TABLES) {
    db.prepare(`UPDATE "${table}" SET userId = ? WHERE userId = ?`).run(to, from);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  die(`database update failed, no rows changed: ${error.message}`);
}
db.close();

// Remove the source directories once they are empty.
for (const dir of [path.join(uploadsRoot, from), path.join(clipboardRoot, from)]) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}

console.log(`\nmoved ${moved} file(s), skipped ${skipped}`);
console.log(`updated ${totalRows} row(s)`);
console.log(`\nRemember to set DEFAULT_ACCOUNT="${to}" (and add "${to}" to USERS) before restarting.`);
