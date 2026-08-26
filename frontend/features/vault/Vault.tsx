"use client";

import { Button } from "@/components/ui/Button";
import { FileText, FolderPlus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { toMentionToken } from "./mock";
import { vaultService } from "./service";
import { type VaultFolder } from "./types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Vault() {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = folders.find((folder) => folder.id === selectedId);

  useEffect(() => {
    let cancelled = false;
    void vaultService
      .listFolders()
      .then((data) => {
        if (cancelled) return;
        setFolders(data);
        setSelectedId((current) =>
          data.some((folder) => folder.id === current)
            ? current
            : (data[0]?.id ?? ""),
        );
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load vault");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateFolder = async () => {
    if (!name.trim()) return;
    try {
      const folder = await vaultService.createFolder({ name, description });
      setFolders((prev) => [...prev, folder]);
      setSelectedId(folder.id);
      setName("");
      setDescription("");
      setIsAdding(false);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create folder");
    }
  };

  const handleUpload = async (list: FileList | null) => {
    if (!list || !selectedId) return;
    try {
      const uploaded = await Promise.all(
        Array.from(list).map((file) =>
          vaultService.uploadFile(selectedId, file),
        ),
      );
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === selectedId
            ? { ...folder, files: [...folder.files, ...uploaded] }
            : folder,
        ),
      );
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not upload file");
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await vaultService.deleteFile(fileId);
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === selectedId
            ? {
                ...folder,
                files: folder.files.filter((file) => file.id !== fileId),
              }
            : folder,
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete file");
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await vaultService.deleteFolder(folderId);
      setFolders((prev) => {
        const next = prev.filter((folder) => folder.id !== folderId);
        if (selectedId === folderId) {
          setSelectedId(next[0]?.id ?? "");
        }
        return next;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete folder");
    }
  };

  if (status === "loading") {
    return (
      <p className="p-6 text-sm text-[#716D65]" role="status">
        Loading vault...
      </p>
    );
  }

  if (status === "error" && folders.length === 0) {
    return (
      <section className="flex h-full flex-col items-start justify-center gap-3 p-6">
        <h1 className="text-lg font-semibold">Could not load Vault</h1>
        <p className="text-sm text-[#716D65]">{error}</p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Knowledge library</h1>
          <p className="mt-1 text-sm text-[#716D65]">
            Store project files, then type @ in chat to reference a folder or
            file.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsAdding(true)}
          >
            <FolderPlus size={16} />
            New folder
          </Button>
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!selected}
          >
            <Upload size={16} />
            Upload
          </Button>
        </div>
      </header>

      {error && (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Upload files to selected folder"
        accept="image/*,.pdf,.md,.txt,.csv,.json,.ts,.tsx,.sql,.docx,.xlsx"
        onChange={(event) => {
          void handleUpload(event.target.files);
          event.target.value = "";
        }}
      />

      {isAdding && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#716D65]/15 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateFolder();
          }}
        >
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
            Folder name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-xl border border-[#716D65]/20 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-pink-300"
            />
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="rounded-xl border border-[#716D65]/20 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-pink-300"
            />
          </label>
          <Button type="submit">Add</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsAdding(false)}
          >
            Cancel
          </Button>
        </form>
      )}

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_1fr]">
        <ul className="min-h-0 overflow-y-auto space-y-2 rounded-2xl border border-[#716D65]/15 bg-white p-2">
          {folders.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-[#716D65]">
              No folders yet.
            </li>
          ) : (
            folders.map((folder) => (
              <li key={folder.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(folder.id)}
                  className={`cursor-pointer min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left ${
                    folder.id === selectedId
                      ? "bg-[#6c854e]/10"
                      : "hover:bg-[#716D65]/10"
                  }`}
                >
                  <p className="truncate text-sm font-medium">{folder.name}</p>
                  <p className="truncate text-xs text-[#716D65]">
                    {toMentionToken(folder.name)} ·{" "}
                    {folder.description || "No description"}
                  </p>
                </button>
                <Button
                  type="button"
                  variant="icon"
                  size="sm"
                  aria-label={`Delete ${folder.name}`}
                  onClick={() => void handleDeleteFolder(folder.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="min-h-0 overflow-y-auto rounded-2xl border border-[#716D65]/15 bg-white p-4">
          {!selected ? (
            <p className="text-sm text-[#716D65]">Select a folder.</p>
          ) : selected.files.length === 0 ? (
            <p className="text-sm text-[#716D65]">
              Empty folder. Upload files to store them in Supabase.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selected.files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-3 rounded-xl border border-[#716D65]/10 px-3 py-2"
                >
                  <FileText size={18} className="shrink-0 text-[#716D65]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-[#716D65]">
                      {toMentionToken(selected.name, file.name)} ·{" "}
                      {formatSize(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="icon"
                    size="sm"
                    aria-label={`Delete ${file.name}`}
                    onClick={() => void handleDeleteFile(file.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
