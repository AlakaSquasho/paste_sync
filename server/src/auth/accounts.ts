import bcrypt from 'bcryptjs';

// Reserved owner id stamped onto pre-existing rows by the add_user_ownership migration.
// It can never be a real username (see RESERVED_USERNAMES).
export const LEGACY_USER_ID = '__legacy__';

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
// "." and ".." satisfy USERNAME_PATTERN but must never become a disk path segment.
const RESERVED_USERNAMES = new Set(['.', '..', LEGACY_USER_ID]);

export interface Account {
  username: string;
  /** Plaintext password or a bcrypt hash. */
  password: string;
}

export interface AccountConfig {
  accounts: Map<string, Account>;
  defaultAccount: string;
}

export const isBcryptHash = (value: string): boolean =>
  value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$');

const assertValidUsername = (username: string, source: string): void => {
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(
      `Invalid username "${username}" in ${source}: must match [A-Za-z0-9._-]{1,32}.`
    );
  }

  if (RESERVED_USERNAMES.has(username)) {
    throw new Error(`Reserved username "${username}" in ${source} is not allowed.`);
  }
};

const parseUsers = (raw: string): Map<string, Account> => {
  const accounts = new Map<string, Account>();
  const seenCaseInsensitive = new Map<string, string>();

  for (const rawSegment of raw.split(',')) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    const separatorIndex = segment.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Malformed USERS entry "${segment}": expected "username:password".`);
    }

    const username = segment.slice(0, separatorIndex).trim();
    // Passwords are not trimmed: surrounding whitespace may be intentional.
    const password = segment.slice(separatorIndex + 1);

    assertValidUsername(username, 'USERS');

    if (!password) {
      throw new Error(`USERS entry for "${username}" has an empty password.`);
    }

    // Filesystem may be case-insensitive (e.g. Windows mounts), so reject
    // usernames that would collide on disk even though they differ as strings.
    const lower = username.toLowerCase();
    const existing = seenCaseInsensitive.get(lower);
    if (existing !== undefined) {
      throw new Error(
        `USERS contains duplicate usernames "${existing}" and "${username}" (compared case-insensitively).`
      );
    }
    seenCaseInsensitive.set(lower, username);

    if (accounts.has(username)) {
      throw new Error(`USERS contains duplicate username "${username}".`);
    }
    accounts.set(username, { username, password });
  }

  return accounts;
};

const buildConfig = (): AccountConfig => {
  const rawUsers = (process.env.USERS ?? '').trim();
  const defaultAccountEnv = (process.env.DEFAULT_ACCOUNT ?? '').trim();

  let accounts = rawUsers ? parseUsers(rawUsers) : new Map<string, Account>();

  // Backwards compatibility: fall back to the legacy single shared password.
  if (accounts.size === 0) {
    const sharedPassword = process.env.SHARED_PASSWORD ?? '';
    if (!sharedPassword) {
      throw new Error(
        'No accounts configured. Set USERS (e.g. "alice:passA,bob:passB") or the legacy SHARED_PASSWORD.'
      );
    }
    const username = defaultAccountEnv || 'default';
    assertValidUsername(username, 'DEFAULT_ACCOUNT');
    accounts = new Map([[username, { username, password: sharedPassword }]]);
  }

  let defaultAccount: string;
  if (defaultAccountEnv) {
    if (!accounts.has(defaultAccountEnv)) {
      throw new Error(
        `DEFAULT_ACCOUNT "${defaultAccountEnv}" is not present in USERS. Known accounts: ${[...accounts.keys()].join(', ')}.`
      );
    }
    defaultAccount = defaultAccountEnv;
  } else {
    defaultAccount = accounts.keys().next().value as string;
  }

  return { accounts, defaultAccount };
};

let cachedConfig: AccountConfig | null = null;

const getConfig = (): AccountConfig => {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }
  return cachedConfig;
};

/** Throws with a descriptive message if USERS or DEFAULT_ACCOUNT are misconfigured. */
export const validateAccountConfig = (): void => {
  getConfig();
};

export const listAccounts = (): Account[] => [...getConfig().accounts.values()];

export const resolveAccount = (username: unknown): Account | null => {
  if (typeof username !== 'string' || !username) return null;
  return getConfig().accounts.get(username) ?? null;
};

export const getDefaultAccount = (): string => getConfig().defaultAccount;

// Unknown usernames still pay for one bcrypt comparison so that response timing
// does not reveal whether an account exists.
let dummyHash: string | null = null;
const getDummyHash = (): string => {
  if (!dummyHash) {
    dummyHash = bcrypt.hashSync('__invalid__', 10);
  }
  return dummyHash;
};

export const verifyCredentials = async (username: unknown, password: unknown): Promise<Account | null> => {
  const candidate = typeof password === 'string' ? password : '';
  const account = resolveAccount(username);
  const storedPassword = account ? account.password : getDummyHash();

  const matches = isBcryptHash(storedPassword)
    ? await bcrypt.compare(candidate, storedPassword)
    : storedPassword === candidate;

  return account && matches ? account : null;
};
