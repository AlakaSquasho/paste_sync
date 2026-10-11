import fs from 'fs';
import path from 'path';

export const UPLOADS_DIR = path.join(__dirname, '../../uploads');
export const CLIPBOARD_IMAGE_DIR = path.join(UPLOADS_DIR, 'clipboard');

export const userUploadsDir = (userId: string): string => path.join(UPLOADS_DIR, userId);
export const userClipboardDir = (userId: string): string => path.join(CLIPBOARD_IMAGE_DIR, userId);

export const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};
