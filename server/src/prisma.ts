import { PrismaClient } from '@prisma/client';

// Single shared client for the whole server process.
const prisma = new PrismaClient();

export default prisma;
