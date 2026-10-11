declare global {
  namespace Express {
    interface Request {
      /** Username of the authenticated account, set by the auth middleware. */
      userId: string;
    }
  }
}

export {};
