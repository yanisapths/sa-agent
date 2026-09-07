"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { workspaceService } from "./service";
import { type CreateWorkspaceInput, type Workspace } from "./types";

interface WorkspaceContextValue {
  workspaces: Workspace[];
  status: "loading" | "ready" | "error";
  error: string | null;
  attached: Workspace | null;
  attach: (id: string) => void;
  detach: () => void;
  refresh: () => Promise<void>;
  create: (input: CreateWorkspaceInput) => Promise<Workspace>;
  remove: (id: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [attachedId, setAttachedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await workspaceService.list();
      setWorkspaces(data);
      setAttachedId((current) =>
        current && data.some((item) => item.id === current) ? current : null,
      );
      setStatus("ready");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const attach = useCallback((id: string) => {
    setAttachedId(id);
  }, []);

  const detach = useCallback(() => {
    setAttachedId(null);
  }, []);

  const create = useCallback(async (input: CreateWorkspaceInput) => {
    const created = await workspaceService.create(input);
    setWorkspaces((prev) => [...prev, created]);
    setAttachedId(created.id);
    setStatus("ready");
    setError(null);
    return created;
  }, []);

  const remove = useCallback(async (id: string) => {
    await workspaceService.delete(id);
    setWorkspaces((prev) => prev.filter((item) => item.id !== id));
    setAttachedId((current) => (current === id ? null : current));
  }, []);

  const attached = useMemo(
    () => workspaces.find((item) => item.id === attachedId) ?? null,
    [workspaces, attachedId],
  );

  const value = useMemo(
    () => ({
      workspaces,
      status,
      error,
      attached,
      attach,
      detach,
      refresh,
      create,
      remove,
    }),
    [
      workspaces,
      status,
      error,
      attached,
      attach,
      detach,
      refresh,
      create,
      remove,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
