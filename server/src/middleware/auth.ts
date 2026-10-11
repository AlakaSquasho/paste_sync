import { Request, Response, NextFunction } from 'express';
import { resolveAccount } from '../auth/accounts';
import { verifyToken } from '../auth/jwt';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: 'Session expired or invalid token' });
  }

  // The account may have been removed from USERS since the token was issued.
  if (!resolveAccount(payload.sub)) {
    return res.status(401).json({ message: 'Account is no longer available' });
  }

  req.userId = payload.sub;
  next();
};
