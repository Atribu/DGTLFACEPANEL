// Server-side, one-time account bootstrap. Contains a salted scrypt digest, never the plaintext password.
// Existing database credentials always win; deployments never reset the account.
const BUNDLED_OWNER_PASSWORD_HASH = "scrypt:0c878ffaf99a28dcb6c4bb3f74ac2c58:f4a1ea2c148341fdfa8c1cfb731720ede4241967318c931ad21231a5de603222f16444bbc99a5be21d7410ea6f2a7f22958d0d8ccd31448d88742b191463af94";

/** Optional server override applies only when the account does not yet exist. */
export function ownerBootstrapPasswordHash(override?: string): string {
  return override || BUNDLED_OWNER_PASSWORD_HASH;
}
