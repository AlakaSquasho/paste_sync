import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import { verifyCredentials } from '../auth/accounts';
import { signToken } from '../auth/jwt';

const router = Router();

// Rate limiter for login: 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per `window`
  message: { message: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  // Artificial delay to prevent timing attacks and slow down brute force
  await new Promise((resolve) => setTimeout(resolve, 500));

  const account = await verifyCredentials(username, password);
  if (!account) {
    // Same message whether the account is unknown or the password is wrong.
    return res.status(401).json({ message: 'Invalid username or password' });
  }

  return res.json({ token: signToken(account.username), username: account.username });
});

router.get('/me', authenticate, (req: Request, res: Response) => {
  return res.json({ username: req.userId });
});

export default router;
