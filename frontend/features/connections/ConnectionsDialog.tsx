"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useProduct } from "@/features/product/ProductProvider";
import { productService } from "@/features/product/service";
import { type Product, type TestRow } from "@/features/product/types";
import { type Connection } from "@/lib/connection";

import { ConnectionsFields, inputClass, type TestableKind } from "./ConnectionsFields";
import {
  connectionsDefaults,
  connectionsForTest,
  envLines,
  toConnections,
  toProductFields,
  useConnectionsForm,
  type ConnectionsFormValues,
} from "./form";
import { loadConnections, type StorageMode } from "./store";

const TEST_ROW: Record<TestableKind, "db" | "docs" | "jira"> = {
  postgres: "db",
  confluence: "docs",
  jira: "jira",
};

function UnlockForm({ onUnlock }: { onUnlock: (passphrase: string) => Promise<void> }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(passphrase);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <label htmlFor="unlock-passphrase" className="block text-xs font-medium">
        Passphrase
      </label>
      <input
        id="unlock-passphrase"
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        autoComplete="current-password"
        className={inputClass}
      />
      {error ? (
        <p className="mt-2 text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button type="submit" size="sm" disabled={!passphrase || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </div>
    </form>
  );
}

function ConnectionsEditor({
  product,
  saved,
  savedMode,
  others,
  onDone,
}: {
  product: Product;
  saved: Connection[];
  savedMode: StorageMode;
  others: Product[];
  onDone: () => void;
}) {
  const { connections, update } = useProduct();
  const form = useConnectionsForm(connectionsDefaults(product, saved, savedMode));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copySource, setCopySource] = useState<Connection[]>([]);
  const passphraseHeld = savedMode === "passphrase" && saved.length > 0;
  const allowEnv = !product.isDefault;

  const handleTest = async (kind: TestableKind): Promise<TestRow> => {
    const ready = connectionsForTest(form.getValues(), [...saved, ...copySource], kind);
    if ("detail" in ready) return { ok: false, detail: ready.detail };
    const result = await productService.test(product.id, ready.connections);
    return result[TEST_ROW[kind]];
  };

  const handleSave = form.handleSubmit(
    async (values: ConnectionsFormValues) => {
      setError(null);
      if (values.mode === "passphrase" && !values.passphrase && !passphraseHeld) {
        form.setError("passphrase", { message: "Enter a passphrase." });
        setError("Enter a passphrase.");
        return;
      }
      try {
        await connections.save(
          toConnections(values, [...saved, ...copySource]),
          values.mode,
          values.passphrase || undefined,
        );
        if (allowEnv) await update(product.id, toProductFields(values));
        onDone();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not save connections.");
      }
    },
    () => {
      setError("Fix the highlighted fields, then save.");
    },
  );

  const handleCopyEnv = async () => {
    const text = envLines(form.getValues(), [...saved, ...copySource], product.slug);
    if (!text) {
      setNotice("Nothing to copy: enter a database URL or Confluence token first.");
      return;
    }
    if (!window.confirm("Copy these secrets to the clipboard as .env lines? Groundwork never writes the file.")) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied. Paste into backend/.env, then switch the sections to “Use env variable”.");
    } catch {
      setNotice("The browser blocked clipboard access.");
    }
  };

  const handleCopyFrom = async (otherId: string) => {
    if (!otherId) return;
    const other = await loadConnections(otherId);
    if (other.status !== "ready") {
      setNotice(other.status === "locked" ? "Unlock that product first." : "That product has no saved connections.");
      return;
    }
    setCopySource(other.connections);
    const current = form.getValues();
    form.reset({ ...connectionsDefaults(product, other.connections, current.mode), passphrase: current.passphrase });
    setNotice("Copied. Review, then save.");
  };

  return (
    <form onSubmit={handleSave} noValidate>
      <ConnectionsFields form={form} allowEnv={allowEnv} passphraseHeld={passphraseHeld} onTest={handleTest} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyEnv()}>
          Copy as .env lines
        </Button>
        {others.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Copy from
            <select
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
              defaultValue=""
              onChange={(event) => void handleCopyFrom(event.target.value)}
            >
              <option value="">another product…</option>
              {others.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-3 text-xs text-muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function ConnectionsDialog() {
  const { active, products, dialog, closeDialog, connections } = useProduct();
  const open = dialog === "connections" && active !== null;
  const { state } = connections;

  return (
    <Dialog
      open={open}
      title={active ? `Connections · ${active.name}` : "Connections"}
      description={
        active?.isDefault
          ? "Default reads backend/.env. Values entered here override it in this browser only."
          : "Each connector is optional. Without one, the agent says it is not connected instead of guessing."
      }
      onClose={closeDialog}
    >
      {!active ? null : state.status === "loading" ? (
        <p className="text-sm text-muted" role="status">
          Loading…
        </p>
      ) : state.status === "locked" ? (
        <UnlockForm onUnlock={connections.unlock} />
      ) : (
        <ConnectionsEditor
          key={`${active.id}:${state.status}`}
          product={active}
          saved={state.status === "ready" ? state.connections : []}
          savedMode={state.status === "ready" ? state.mode : "device"}
          others={products.filter((item) => item.id !== active.id)}
          onDone={closeDialog}
        />
      )}
    </Dialog>
  );
}
