import { Router, Request, Response } from 'express';
import multer from 'multer';
import prisma from '../prisma';
import { authenticate } from '../middleware/auth';
import path from 'path';
import fs from 'fs';
import { broadcastSyncEvent } from '../ws';
import { ensureDir, userClipboardDir } from '../storage/paths';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = userClipboardDir(req.userId);
    try {
      ensureDir(dir);
      cb(null, dir);
    } catch (error: any) {
      cb(error, dir);
    }
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

const deleteImageFromDisk = (userId: string, filename: string) => {
  const filePath = path.join(userClipboardDir(userId), filename);
  fs.unlink(filePath, (err) => {
    if (err) console.error('Failed to delete clipboard image from disk:', err);
  });
};

// PUT /api/clipboard/image - upload new image, replacing any existing one for this account
router.put('/', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Delete this account's existing clipboard image if any
    const existing = await prisma.clipboardImage.findFirst({ where: { userId } });
    if (existing) {
      deleteImageFromDisk(userId, existing.filename);
      await prisma.clipboardImage.delete({ where: { id: existing.id } });
    }

    const newRecord = await prisma.clipboardImage.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        userId,
      },
    });

    broadcastSyncEvent(userId, 'clipboard_updated');
    return res.json({
      id: newRecord.id,
      mimetype: newRecord.mimetype,
      size: newRecord.size,
      originalName: newRecord.originalName,
    });
  } catch (error) {
    // Clean up uploaded file if DB write failed
    deleteImageFromDisk(userId, req.file.filename);
    return res.status(500).json({ error: 'Failed to save clipboard image' });
  }
});

// GET /api/clipboard/image - retrieve this account's current clipboard image blob
router.get('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.userId;

  try {
    const record = await prisma.clipboardImage.findFirst({ where: { userId } });
    if (!record) {
      return res.status(404).json({ error: 'No clipboard image' });
    }

    const filePath = path.join(userClipboardDir(userId), record.filename);
    res.setHeader('Content-Type', record.mimetype);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve clipboard image' });
  }
});

// DELETE /api/clipboard/image - delete this account's current clipboard image
router.delete('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.userId;

  try {
    const record = await prisma.clipboardImage.findFirst({ where: { userId } });
    if (!record) {
      return res.status(404).json({ error: 'No clipboard image' });
    }

    deleteImageFromDisk(userId, record.filename);
    await prisma.clipboardImage.delete({ where: { id: record.id } });

    broadcastSyncEvent(userId, 'clipboard_updated');
    return res.json({ message: 'Clipboard image deleted' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete clipboard image' });
  }
});

export default router;
