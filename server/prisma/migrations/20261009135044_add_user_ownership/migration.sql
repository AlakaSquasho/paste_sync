/*
  Adds per-account ownership (`userId`) to Clipboard, ClipboardImage and FileMetadata.

  `userId` is required with no SQL default so that any future insert that forgets it
  fails loudly instead of silently writing an ownerless row. Existing rows cannot
  satisfy a NOT NULL column without a default, so the tables are rebuilt and the
  existing rows are stamped with the reserved sentinel '__legacy__'.

  The server assigns '__legacy__' rows to the configured DEFAULT_ACCOUNT at startup
  (see server/src/storage/backfillOwnership.ts). '__legacy__' is not a valid username.

  Warnings:

  - Added the required column `userId` to the `Clipboard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `ClipboardImage` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `FileMetadata` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Clipboard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Clipboard" ("content", "createdAt", "id", "userId") SELECT "content", "createdAt", "id", '__legacy__' FROM "Clipboard";
DROP TABLE "Clipboard";
ALTER TABLE "new_Clipboard" RENAME TO "Clipboard";
CREATE INDEX "Clipboard_userId_createdAt_idx" ON "Clipboard"("userId", "createdAt");
CREATE TABLE "new_ClipboardImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ClipboardImage" ("createdAt", "filename", "id", "mimetype", "originalName", "size", "userId") SELECT "createdAt", "filename", "id", "mimetype", "originalName", "size", '__legacy__' FROM "ClipboardImage";
DROP TABLE "ClipboardImage";
ALTER TABLE "new_ClipboardImage" RENAME TO "ClipboardImage";
CREATE INDEX "ClipboardImage_userId_createdAt_idx" ON "ClipboardImage"("userId", "createdAt");
CREATE TABLE "new_FileMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_FileMetadata" ("createdAt", "filename", "id", "mimetype", "originalName", "size", "userId") SELECT "createdAt", "filename", "id", "mimetype", "originalName", "size", '__legacy__' FROM "FileMetadata";
DROP TABLE "FileMetadata";
ALTER TABLE "new_FileMetadata" RENAME TO "FileMetadata";
CREATE INDEX "FileMetadata_userId_createdAt_idx" ON "FileMetadata"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
