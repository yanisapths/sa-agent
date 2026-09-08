"use client";

import { Button } from "@/components/ui/Button";
import { Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { workspaceService } from "./service";

interface AddFolderDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, path: string) => Promise<void>;
}

function folderNameFromPath(absPath: string): string {
  const trimmed = absPath.replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function AddFolderDialog({
  open,
  onClose,
  onCreate,
}: AddFolderDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedForPick = useRef(false);
  const pickingRef = useRef(false);
  const savingRef = useRef(false);

  const reset = () => {
    setName("");
    setPath("");
    setError(null);
    setSaving(false);
    setPicking(false);
    pickingRef.current = false;
    savingRef.current = false;
  };

  const handlePick = async () => {
    if (pickingRef.current || savingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    setError(null);
    try {
      const result = await workspaceService.pickFolder();
      const picked = result.path;
      if (!picked) return;
      setPath(picked);
      setName((current) => current.trim() || folderNameFromPath(picked));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not open Finder",
      );
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };

  useEffect(() => {
    if (!open) {
      openedForPick.current = false;
      return;
    }
    if (openedForPick.current) return;
    openedForPick.current = true;
    void handlePick();
  }, [open]);

  const handleClose = () => {
    if (pickingRef.current) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim() || !path.trim() || savingRef.current || pickingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim(), path.trim());
      reset();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add folder");
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="aster-overlay flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-folder-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="add-folder-title" className="text-base font-semibold">
          Add project folder
        </h2>
        <p className="mt-1 text-xs text-muted">
          Choose a folder in Finder. The backend must be running on this Mac.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          disabled={picking || saving}
          onClick={() => void handlePick()}
        >
          <Folder className="h-4 w-4" />
          {picking ? "Waiting for Finder…" : "Choose in Finder"}
        </Button>
        <label className="mt-4 block text-xs font-medium">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="admin-service"
          disabled={picking}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-light"
        />
        <label className="mt-3 block text-xs font-medium">Path</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/src/admin-service"
          disabled={picking}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-light"
        />
        {error && (
          <p className="mt-3 text-xs text-rose-600" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={picking}
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!name.trim() || !path.trim() || saving || picking}
            onClick={() => void handleSubmit()}
          >
            {saving ? "Adding…" : "Add folder"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
