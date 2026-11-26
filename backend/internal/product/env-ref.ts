const PRODUCT_ENV = /^SA_PRODUCT_[A-Z0-9_]+$/;

export class EnvRefError extends Error {
  constructor(name: string) {
    super(`${name} is not a product env reference. Use a name starting with SA_PRODUCT_.`);
    this.name = "EnvRefError";
  }
}

export function isProductEnvRef(name: string): boolean {
  return PRODUCT_ENV.test(name);
}

/**
 * Reads a product's env reference. Anything outside `SA_PRODUCT_*` throws, so
 * a stored profile can never read `SUPABASE_SERVICE_ROLE_KEY` or
 * `BIFROST_API_KEY`. Default reads its own env directly and never comes here.
 * An empty variable is `undefined`: the capability is off, not an error.
 */
export function resolveEnvRef(
  name: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!name) return undefined;
  if (!isProductEnvRef(name)) throw new EnvRefError(name);
  const value = env[name]?.trim();
  return value ? value : undefined;
}
