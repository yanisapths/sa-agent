"use client";

export default function VaultError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="flex h-full flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-lg font-semibold">Could not load Vault</h1>
      <p className="text-sm text-[#716D65]">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-pink-300 px-4 py-2 text-sm font-medium text-pink-950"
      >
        Try again
      </button>
    </section>
  );
}
