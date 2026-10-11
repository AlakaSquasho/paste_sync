import jwt from 'jsonwebtoken';

const TOKEN_TTL = '7d';
const PLACEHOLDER_SECRETS = new Set(['', 'secret', 'your_secret_key_here']);

let cachedSecret: string | null = null;

/**
 * A guessable JWT secret lets anyone mint a token for any account, so the
 * placeholder values that used to be accepted are rejected outright.
 */
export const getJwtSecret = (): string => {
  if (cachedSecret) return cachedSecret;

  const secret = process.env.JWT_SECRET ?? '';
  if (PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET must be set to a strong, unique value (empty/placeholder values are rejected).'
    );
  }

  cachedSecret = secret;
  return secret;
};

/** Validates configuration that would otherwise fail lazily at request time. */
export const assertJwtSecret = (): void => {
  getJwtSecret();
};

export interface TokenPayload {
  sub: string;
  username: string;
  role: 'user';
}

export const signToken = (username: string): string =>
  jwt.sign({ sub: username, username, role: 'user' }, getJwtSecret(), { expiresIn: TOKEN_TTL });

/**
 * Returns the payload, or null for a malformed, expired, or subject-less token.
 * Tokens issued before multi-account support carry no `sub` and are rejected so
 * that the client re-authenticates.
 */
export const verifyToken = (token: string): TokenPayload | null => {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded === 'string') return null;

    const { sub, username } = decoded as { sub?: unknown; username?: unknown };
    if (typeof sub !== 'string' || !sub) return null;

    return { sub, username: typeof username === 'string' ? username : sub, role: 'user' };
  } catch {
    return null;
  }
};
