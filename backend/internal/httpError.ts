export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

type PostgrestLike = {
  code?: string;
  message?: string;
};

export function errorMessageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as PostgrestLike).message;
    if (typeof message === "string" && message) return message;
  }
  return "Internal server error";
}

export function throwIfError(error: unknown): void {
  if (!error) return;
  const code =
    typeof error === "object" && error && "code" in error
      ? (error as PostgrestLike).code
      : undefined;
  if (code === "PGRST205") {
    throw new HttpError(
      503,
      "Vault tables are missing. Run backend/sql/vault.sql in the Supabase SQL editor.",
    );
  }
  throw new HttpError(500, errorMessageOf(error));
}

export function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export function queryNumber(value: unknown, fallback: number): number {
  const raw = queryString(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
