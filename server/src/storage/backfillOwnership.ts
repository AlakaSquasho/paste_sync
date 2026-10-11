import fs from 'fs';
import path from 'path';
import prisma from '../prisma';
import { LEGACY_USER_ID, listAccounts } from '../auth/accounts';
import {
  CLIPBOARD_IMAGE_DIR,
  UPLOADS_DIR,
  ensureDir,
  userClipboardDir,
  userUploadsDir,
} from './paths';

const moveFile = (source: string, target: string): void => {
  try {
    fs.renameSync(source, target);
  } catch (error: any) {
    if (error?.code === 'EXDEV') {
      fs.copyFileSync(source, target);
      fs.unlinkSync(source);
      return;
    }
    throw error;
  }
};

/** Moves files sitting directly in `sourceDir` into `targetDir`; skips directories. */
const moveFlatFilesInto = (sourceDir: string, targetDir: string): number => {
  if (!fs.existsSync(sourceDir)) return 0;

  ensureDir(targetDir);
  let moved = 0;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    // Already migrated by an earlier run.
    if (fs.existsSync(target)) continue;

    moveFile(source, target);
    moved += 1;
  }

  return moved;
};

const warnAboutOrphanedAccountDirs = (
  rootDir: string,
  knownAccounts: Set<string>,
  ignoredDirNames: Set<string> = new Set()
): void => {
  if (!fs.existsSync(rootDir)) return;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (knownAccounts.has(entry.name) || ignoredDirNames.has(entry.name)) continue;
    console.warn(
      `[ownership] upload directory "${path.join(rootDir, entry.name)}" does not match any configured account.`
    );
  }
};

/**
 * Assigns data created before multi-account support to the default account.
 * Idempotent: safe to run on every startup.
 *
 * Files are moved before the database is updated, because the database is the
 * source of truth for on-disk paths — it must never point at
 * `uploads/<account>/...` before the file is actually there. A crash between the
 * two steps self-heals on the next start: the move skips files that already
 * landed, and the update then matches whatever rows are left.
 */
export const runOwnershipBackfill = async (defaultAccount: string): Promise<void> => {
  ensureDir(UPLOADS_DIR);
  ensureDir(CLIPBOARD_IMAGE_DIR);

  const movedFiles = moveFlatFilesInto(UPLOADS_DIR, userUploadsDir(defaultAccount));
  const movedImages = moveFlatFilesInto(CLIPBOARD_IMAGE_DIR, userClipboardDir(defaultAccount));

  if (movedFiles || movedImages) {
    console.log(
      `[ownership] moved ${movedFiles} file(s) and ${movedImages} clipboard image(s) into account "${defaultAccount}".`
    );
  }

  const knownAccounts = new Set(listAccounts().map((account) => account.username));
  // `uploads/clipboard` is the clipboard-image root, not an account directory.
  const reservedUploadDirs = new Set([path.basename(CLIPBOARD_IMAGE_DIR)]);
  warnAboutOrphanedAccountDirs(UPLOADS_DIR, knownAccounts, reservedUploadDirs);
  warnAboutOrphanedAccountDirs(CLIPBOARD_IMAGE_DIR, knownAccounts);

  try {
    const [clipboard, images, files] = await Promise.all([
      prisma.clipboard.updateMany({ where: { userId: LEGACY_USER_ID }, data: { userId: defaultAccount } }),
      prisma.clipboardImage.updateMany({ where: { userId: LEGACY_USER_ID }, data: { userId: defaultAccount } }),
      prisma.fileMetadata.updateMany({ where: { userId: LEGACY_USER_ID }, data: { userId: defaultAccount } }),
    ]);

    const reassigned = clipboard.count + images.count + files.count;
    if (reassigned) {
      console.log(`[ownership] reassigned ${reassigned} row(s) to account "${defaultAccount}".`);
    }
  } catch (error: any) {
    throw new Error(
      `Failed to assign legacy data to "${defaultAccount}": ${error?.message ?? error}. ` +
        'Has the database migration been applied? Run `npm run prisma:migrate --workspace=server`.'
    );
  }
};
