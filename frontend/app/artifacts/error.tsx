"use client";

export default function ArtifactsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="flex h-full flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-lg font-semibold">Could not load Artifacts</h1>
      <p className="text-sm text-muted">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </section>
  );
}
