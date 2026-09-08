"use client";

import { Button } from "@/components/ui/Button";
import {
  Check,
  Copy,
  Download,
  FileText,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { artifactService, triggerBlobDownload } from "./service";
import {
  type ArtifactContent,
  type ArtifactFile,
  type ArtifactFileDetail,
} from "./types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function threadLabel(threadId: string): string {
  return `Chat ${threadId.slice(0, 8)}`;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function Artifacts() {
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [detail, setDetail] = useState<ArtifactFileDetail | null>(null);
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, ArtifactFile[]>();
    for (const file of files) {
      const list = map.get(file.threadId) ?? [];
      list.push(file);
      map.set(file.threadId, list);
    }
    return [...map.entries()];
  }, [files]);

  const selected = files.find((file) => file.id === selectedId);

  const loadFiles = async (preferId?: string) => {
    const data = await artifactService.listFiles();
    setFiles(data);
    setSelectedId((current) => {
      const next = preferId || current;
      if (next && data.some((file) => file.id === next)) return next;
      return data[0]?.id ?? "";
    });
    setStatus("ready");
  };

  useEffect(() => {
    let cancelled = false;
    const requested =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("file")
        : null;
    void artifactService
      .listFiles()
      .then((data) => {
        if (cancelled) return;
        setFiles(data);
        const initial =
          requested && data.some((file) => file.id === requested)
            ? requested
            : (data[0]?.id ?? "");
        setSelectedId(initial);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load artifacts",
        );
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setContent(null);
      setImageUrl(null);
      setIsEditing(false);
      return;
    }

    let cancelled = false;
    setIsEditing(false);
    setPreviewVersion(null);
    setError(null);

    void Promise.all([
      artifactService.getFile(selectedId),
      artifactService.getContent(selectedId),
    ])
      .then(async ([file, body]) => {
        if (cancelled) return;
        setDetail(file);
        setContent(body);
        if (body.isText) setDraft(body.text ?? "");
        if (!body.isText && isImageMime(body.mimeType)) {
          const blob = await artifactService.downloadFile(selectedId);
          if (cancelled) return;
          setImageUrl(URL.createObjectURL(blob));
        } else {
          setImageUrl(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load artifact",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const handleSelectVersion = async (version: number) => {
    if (!selectedId) return;
    setPreviewVersion(version);
    setIsEditing(false);
    try {
      const body = await artifactService.getContent(selectedId, version);
      setContent(body);
      if (body.isText) setDraft(body.text ?? "");
      if (!body.isText && isImageMime(body.mimeType)) {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        const blob = await artifactService.downloadFile(selectedId, version);
        setImageUrl(URL.createObjectURL(blob));
      } else {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        setImageUrl(null);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load version");
    }
  };

  const handleDownload = async () => {
    if (!selected) return;
    try {
      const blob = await artifactService.downloadFile(
        selected.id,
        previewVersion ?? undefined,
      );
      triggerBlobDownload(blob, selected.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not download file");
    }
  };

  const handleCopyText = async () => {
    const text = content?.text;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyFile = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const copiedFile = await artifactService.copyFile(selected.id);
      await loadFiles(copiedFile.id);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not copy file");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await artifactService.editFile(selected.id, draft);
      await loadFiles(selected.id);
      const [file, body] = await Promise.all([
        artifactService.getFile(selected.id),
        artifactService.getContent(selected.id),
      ]);
      setDetail(file);
      setContent(body);
      setDraft(body.text ?? "");
      setIsEditing(false);
      setPreviewVersion(null);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save edit");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    setBusy(true);
    try {
      await artifactService.deleteFile(fileId);
      const remaining = files.filter((file) => file.id !== fileId);
      setFiles(remaining);
      if (selectedId === fileId) {
        setSelectedId(remaining[0]?.id ?? "");
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete file");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVersion = async (version: number) => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await artifactService.deleteVersion(selected.id, version);
      if (result.currentVersion == null) {
        const remaining = files.filter((file) => file.id !== selected.id);
        setFiles(remaining);
        setSelectedId(remaining[0]?.id ?? "");
      } else {
        await loadFiles(selected.id);
        const [file, body] = await Promise.all([
          artifactService.getFile(selected.id),
          artifactService.getContent(selected.id),
        ]);
        setDetail(file);
        setContent(body);
        setPreviewVersion(null);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete version");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <p className="p-6 text-sm text-muted" role="status">
        Loading artifacts...
      </p>
    );
  }

  if (status === "error" && files.length === 0) {
    return (
      <section className="flex h-full flex-col items-start justify-center gap-3 p-6">
        <h1 className="text-lg font-semibold">Could not load Artifacts</h1>
        <p className="text-sm text-muted">{error}</p>
      </section>
    );
  }

  const canEdit = Boolean(content?.isText);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <header>
        <h1 className="text-lg font-semibold">Artifacts</h1>
        <p className="mt-1 text-sm text-muted">
          Phase results and generated files. Type @Artifacts in chat to
          reference them.
        </p>
      </header>

      {error && (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[260px_1fr]">
        <ul className="min-h-0 overflow-y-auto space-y-3 rounded-2xl border border-border bg-surface p-2">
          {groups.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted">
              No artifacts yet. Run a phase or ask the agent to generate a
              file.
            </li>
          ) : (
            groups.map(([threadId, threadFiles]) => (
              <li key={threadId}>
                <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
                  {threadLabel(threadId)}
                </p>
                <ul className="flex flex-col gap-1">
                  {threadFiles.map((file) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(file.id)}
                        className={`w-full cursor-pointer rounded-xl px-3 py-2 text-left ${
                          file.id === selectedId
                            ? "bg-sidebar-accent"
                            : "hover:bg-muted/10"
                        }`}
                      >
                        <p className="truncate text-sm font-medium">
                          {file.name}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {file.mentionToken}
                          {file.phase ? ` · ${file.phase}` : ""} · v
                          {file.currentVersion}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))
          )}
        </ul>

        <div className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-surface p-4">
          {!selected || !detail ? (
            <p className="text-sm text-muted">Select a file to preview.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <FileText size={16} className="shrink-0 text-muted" />
                    <span className="truncate">{selected.name}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {selected.mentionToken} · {formatSize(selected.size)} · v
                    {previewVersion ?? selected.currentVersion}
                    {selected.phase ? ` · ${selected.phase}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownload()}
                    disabled={busy}
                  >
                    <Download size={14} />
                    Download
                  </Button>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCopyText()}
                      disabled={busy || !content?.text}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyFile()}
                    disabled={busy}
                  >
                    Duplicate
                  </Button>
                  {canEdit && !isEditing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDraft(content?.text ?? "");
                        setIsEditing(true);
                      }}
                      disabled={busy}
                    >
                      <Pencil size={14} />
                      Edit
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="icon"
                    size="sm"
                    aria-label={`Delete ${selected.name}`}
                    onClick={() => void handleDeleteFile(selected.id)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-background p-3">
                {isEditing ? (
                  <div className="flex h-full min-h-48 flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      className="min-h-48 flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-light"
                      aria-label={`Edit ${selected.name}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleSaveEdit()}
                        disabled={busy}
                      >
                        Save as new version
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsEditing(false);
                          setDraft(content?.text ?? "");
                        }}
                      >
                        <X size={14} />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : content?.isText ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                    {content.text}
                  </pre>
                ) : imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt={selected.name}
                    className="max-h-full max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <p className="text-sm text-muted">
                    Preview is not available for this file type. Download it
                    instead.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Versions
                </p>
                <ul className="flex flex-col gap-1">
                  {detail.versions.map((version) => {
                    const isCurrent =
                      (previewVersion ?? detail.currentVersion) ===
                      version.version;
                    return (
                      <li
                        key={version.id}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                          isCurrent ? "bg-muted/10" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 cursor-pointer text-left text-xs"
                          onClick={() =>
                            void handleSelectVersion(version.version)
                          }
                        >
                          v{version.version} · {version.source} ·{" "}
                          {formatSize(version.size)} ·{" "}
                          {new Date(version.createdAt).toLocaleString()}
                        </button>
                        {detail.versions.length > 1 && (
                          <Button
                            type="button"
                            variant="icon"
                            size="sm"
                            aria-label={`Delete version ${version.version}`}
                            onClick={() =>
                              void handleDeleteVersion(version.version)
                            }
                            disabled={busy}
                          >
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
