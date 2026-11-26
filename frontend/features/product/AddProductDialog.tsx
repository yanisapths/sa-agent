"use client";

import { Folder } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ConnectionsFields, inputClass, type TestableKind } from "@/features/connections/ConnectionsFields";
import {
  connectionsDefaults,
  connectionsForTest,
  toConnections,
  useConnectionsForm,
} from "@/features/connections/form";
import { saveConnections } from "@/features/connections/store";
import { workspaceService } from "@/features/workspace/service";
import { cn } from "@/lib/utils";

import { applyImport, folderName, toProductInput, useProductForm } from "./form";
import { useProduct } from "./ProductProvider";
import { productService } from "./service";
import { type ConnectionTest, type TestRow } from "./types";

const STEPS = ["Product", "Connections", "Check"] as const;

const TEST_ROWS: { key: keyof ConnectionTest; label: string }[] = [
  { key: "db", label: "Database" },
  { key: "docs", label: "Confluence" },
  { key: "jira", label: "Jira" },
  { key: "index", label: "Index" },
  { key: "repos", label: "Repos" },
];

const TEST_ROW: Record<TestableKind, "db" | "docs" | "jira"> = {
  postgres: "db",
  confluence: "docs",
  jira: "jira",
};

function rowLabel(row: TestRow): string {
  if (row.ok === true) return "Pass";
  if (row.ok === false) return "Fail";
  return "Skipped";
}

function AddProductFlow({ onClose }: { onClose: () => void }) {
  const { create, switchTo } = useProduct();
  const productForm = useProductForm();
  const connectionsForm = useConnectionsForm(connectionsDefaults(null, []));
  const [step, setStep] = useState(0);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = () => toProductInput(productForm.getValues(), connectionsForm.getValues());
  const browserConnections = () => toConnections(connectionsForm.getValues(), []);

  const handlePick = async () => {
    if (picking) return;
    setPicking(true);
    setNotice(null);
    setError(null);
    try {
      const { path } = await workspaceService.pickFolder();
      if (!path) return;
      productForm.setValue("repoPath", path);
      productForm.setValue("repoName", folderName(path));
      const imported = await productService.import(path);
      if (imported.found && imported.profile) {
        const profile = imported.profile;
        if (!productForm.getValues("name")) productForm.setValue("name", profile.name);
        productForm.setValue("index", {
          apiSpecCollection: profile.index.apiSpecCollection ?? "",
          ddlCollection: profile.index.ddlCollection ?? "",
        });
        connectionsForm.reset(applyImport(profile, connectionsForm.getValues()));
        setNotice("Filled in from .sa/product.json in that folder.");
      } else if (!productForm.getValues("name")) {
        productForm.setValue("name", folderName(path));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open Finder");
    } finally {
      setPicking(false);
    }
  };

  const handleTestSection = async (kind: TestableKind): Promise<TestRow> => {
    const ready = connectionsForTest(connectionsForm.getValues(), [], kind);
    if ("detail" in ready) return { ok: false, detail: ready.detail };
    const test = await productService.test(null, ready.connections, draft());
    return test[TEST_ROW[kind]];
  };

  const runTest = async () => {
    setTesting(true);
    setError(null);
    try {
      setResult(await productService.test(null, browserConnections(), draft()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  };

  const goNext = async () => {
    setError(null);
    if (step === 0) {
      if (await productForm.trigger()) setStep(1);
      return;
    }
    if (step === 1) {
      const values = connectionsForm.getValues();
      if (!(await connectionsForm.trigger())) return;
      if (values.mode === "passphrase" && !values.passphrase) {
        connectionsForm.setError("passphrase", { message: "Enter a passphrase." });
        return;
      }
      setStep(2);
      void runTest();
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const values = connectionsForm.getValues();
      const created = await create(draft());
      await saveConnections(created.id, browserConnections(), values.mode, values.passphrase || undefined);
      switchTo(created.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add the product.");
      setSaving(false);
    }
  };

  const hasFailure = result ? TEST_ROWS.some(({ key }) => result[key].ok === false) : false;
  const nameError = productForm.formState.errors.name?.message;

  return (
    <div>
      <ol className="mb-4 flex gap-2 text-xs" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "flex-1 rounded-lg border px-2 py-1 text-center",
              index === step ? "border-light font-medium text-foreground" : "border-border text-muted",
            )}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div>
          <label htmlFor="product-name" className="block text-xs font-medium">
            Name
          </label>
          <input
            id="product-name"
            {...productForm.register("name")}
            placeholder="Club&co"
            className={inputClass}
          />
          {nameError ? (
            <p className="mt-1 text-[11px] text-rose-600" role="alert">
              {nameError}
            </p>
          ) : null}
          <p className="mt-4 text-xs font-medium">Repo folder (optional)</p>
          <Button
            type="button"
            variant="outline"
            className="mt-1 w-full"
            disabled={picking}
            onClick={() => void handlePick()}
          >
            <Folder className="h-4 w-4" />
            {picking ? "Waiting for Finder…" : "Choose in Finder"}
          </Button>
          {productForm.watch("repoPath") ? (
            <p className="mt-2 truncate font-mono text-[11px] text-muted">{productForm.watch("repoPath")}</p>
          ) : null}
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted">Index collections (optional)</summary>
            <label htmlFor="product-ddl" className="mt-2 block text-xs font-medium">
              DDL collection
            </label>
            <input
              id="product-ddl"
              {...productForm.register("index.ddlCollection")}
              placeholder="clubco_ddl"
              className={inputClass}
            />
            <label htmlFor="product-api" className="mt-2 block text-xs font-medium">
              API spec collection
            </label>
            <input
              id="product-api"
              {...productForm.register("index.apiSpecCollection")}
              placeholder="clubco_api"
              className={inputClass}
            />
          </details>
        </div>
      ) : null}

      {step === 1 ? (
        <ConnectionsFields
          form={connectionsForm}
          allowEnv
          passphraseHeld={false}
          onTest={handleTestSection}
        />
      ) : null}

      {step === 2 ? (
        <div>
          {testing ? (
            <p className="text-sm text-muted" role="status">
              Testing connections…
            </p>
          ) : result ? (
            <table className="w-full text-left text-xs">
              <tbody>
                {TEST_ROWS.map(({ key, label }) => (
                  <tr key={key} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {label}
                    </th>
                    <td
                      className={cn(
                        "py-2 pr-3 font-medium",
                        result[key].ok === false ? "text-rose-600" : "text-muted",
                      )}
                    >
                      {rowLabel(result[key])}
                    </td>
                    <td className="py-2 text-muted">{result[key].detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

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

      <div className="mt-5 flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
        >
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 2 ? (
          <Button type="button" size="sm" disabled={picking} onClick={() => void goNext()}>
            Next
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void runTest()}>
              Test again
            </Button>
            <Button type="button" size="sm" disabled={saving || testing} onClick={() => void handleSave()}>
              {saving ? "Adding…" : hasFailure ? "Save anyway" : "Add product"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AddProductDialog() {
  const { dialog, closeDialog } = useProduct();
  const open = dialog === "add";
  return (
    <Dialog
      open={open}
      title="Add product"
      description="A product is one codebase with its own database, docs and repos. Every connection is optional."
      onClose={closeDialog}
    >
      {open ? <AddProductFlow onClose={closeDialog} /> : null}
    </Dialog>
  );
}
