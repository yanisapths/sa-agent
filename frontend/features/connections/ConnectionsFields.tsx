"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { type FieldPath, type UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { type TestRow } from "@/features/product/types";
import { cn } from "@/lib/utils";

import { type ConnectionsFormValues } from "./form";
import { STORAGE_MODES } from "./store";

export const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-light disabled:opacity-60";

export type TestableKind = "postgres" | "confluence" | "jira";

interface ConnectionsFieldsProps {
  form: UseFormReturn<ConnectionsFormValues>;
  /** Env-var references need a saved product; Default reads its own `.env`. */
  allowEnv: boolean;
  /** Passphrase mode is already unlocked for this product, so no new passphrase is required. */
  passphraseHeld: boolean;
  onTest?: (kind: TestableKind) => Promise<TestRow>;
}

type FieldName = FieldPath<ConnectionsFormValues>;

function FieldError({ form, name }: { form: UseFormReturn<ConnectionsFormValues>; name: FieldName }) {
  const parts = name.split(".");
  let node: unknown = form.formState.errors;
  for (const part of parts) node = (node as Record<string, unknown> | undefined)?.[part];
  const message = (node as { message?: string } | undefined)?.message;
  if (!message) return null;
  return (
    <p className="mt-1 text-[11px] text-rose-600" role="alert">
      {message}
    </p>
  );
}

function TextField({
  form,
  name,
  label,
  placeholder,
  hint,
}: {
  form: UseFormReturn<ConnectionsFormValues>;
  name: FieldName;
  label: string;
  placeholder?: string;
  hint?: string;
}) {
  const id = `conn-${name.replace(/\./g, "-")}`;
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        {...form.register(name)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
      <FieldError form={form} name={name} />
    </div>
  );
}

/** A stored secret is shown as dots with Replace and Remove; there is no reveal. */
function SecretField({
  form,
  name,
  savedName,
  label,
  placeholder,
}: {
  form: UseFormReturn<ConnectionsFormValues>;
  name: FieldName;
  savedName: FieldName;
  label: string;
  placeholder?: string;
}) {
  const id = `conn-${name.replace(/\./g, "-")}`;
  const hasSaved = Boolean(form.watch(savedName));
  const [replacing, setReplacing] = useState(false);

  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      {hasSaved && !replacing ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-muted">
            ••••••••
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => form.setValue(savedName, false, { shouldDirty: true })}
          >
            Remove
          </Button>
        </div>
      ) : (
        <input
          id={id}
          type="password"
          {...form.register(name)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
      )}
      <FieldError form={form} name={name} />
    </div>
  );
}

function SourceSwitch({
  form,
  name,
}: {
  form: UseFormReturn<ConnectionsFormValues>;
  name: "postgres.source" | "confluence.source";
}) {
  const value = form.watch(name);
  return (
    <div className="mt-3 flex rounded-lg border border-border p-0.5 text-xs" role="radiogroup" aria-label="Value source">
      {(
        [
          ["browser", "Enter value"],
          ["env", "Use env variable"],
        ] as const
      ).map(([option, label]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => form.setValue(name, option, { shouldDirty: true })}
          className={cn(
            "flex-1 cursor-pointer rounded-md px-2 py-1 font-medium",
            value === option ? "bg-muted/15 text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TestResult({ row }: { row: TestRow | null }) {
  if (!row) return null;
  const label = row.ok === true ? "Passed" : row.ok === false ? "Failed" : "Skipped";
  return (
    <p
      className={cn("mt-2 text-[11px]", row.ok === false ? "text-rose-600" : "text-muted")}
      role="status"
    >
      <span className="font-medium">{label}:</span> {row.detail}
    </p>
  );
}

function Section({
  title,
  enabled,
  onToggle,
  modeLabel,
  children,
  onTest,
}: {
  title: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  modeLabel: string | null;
  children: ReactNode;
  onTest?: () => Promise<TestRow>;
}) {
  const [open, setOpen] = useState(enabled);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestRow | null>(null);

  const handleTest = async () => {
    if (!onTest) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await onTest());
    } catch (err: unknown) {
      setResult({ ok: false, detail: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex flex-1 cursor-pointer items-center gap-2 text-left text-sm font-medium"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
          {title}
          {modeLabel && enabled ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-normal text-muted">
              {modeLabel}
            </span>
          ) : null}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              onToggle(event.target.checked);
              if (event.target.checked) setOpen(true);
            }}
          />
          Use
        </label>
      </div>
      {open && enabled ? (
        <div>
          {children}
          {onTest ? (
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void handleTest()}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <TestResult row={result} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ConnectionsFields({ form, allowEnv, passphraseHeld, onTest }: ConnectionsFieldsProps) {
  const values = form.watch();
  const modeLabel = STORAGE_MODES.find((item) => item.id === values.mode)?.label ?? null;
  const browserLabel = (source: "browser" | "env") => (source === "env" ? "Env variable" : modeLabel);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        Stays in this browser. Groundwork sends it only to your backend over localhost or HTTPS and never stores it
        on a server.
      </p>

      <Section
        title="Database"
        enabled={values.postgres.enabled}
        onToggle={(next) => form.setValue("postgres.enabled", next, { shouldDirty: true })}
        modeLabel={browserLabel(values.postgres.source)}
        onTest={onTest ? () => onTest("postgres") : undefined}
      >
        {allowEnv ? <SourceSwitch form={form} name="postgres.source" /> : null}
        {values.postgres.source === "env" && allowEnv ? (
          <TextField
            form={form}
            name="postgres.urlEnv"
            label="Env variable with the URL"
            placeholder="SA_PRODUCT_CLUBCO_DATABASE_URL"
            hint="Set it in backend/.env. Use a read-only database user."
          />
        ) : (
          <SecretField
            form={form}
            name="postgres.url"
            savedName="postgres.hasSavedUrl"
            label="Connection URL"
            placeholder="postgresql://readonly:password@host:5432/app"
          />
        )}
        <TextField form={form} name="postgres.schema" label="Schema" placeholder="public" />
      </Section>

      <Section
        title="Confluence"
        enabled={values.confluence.enabled}
        onToggle={(next) => form.setValue("confluence.enabled", next, { shouldDirty: true })}
        modeLabel={browserLabel(values.confluence.source)}
        onTest={onTest ? () => onTest("confluence") : undefined}
      >
        {allowEnv ? <SourceSwitch form={form} name="confluence.source" /> : null}
        <TextField
          form={form}
          name="confluence.baseUrl"
          label="Site URL"
          placeholder="https://acme.atlassian.net/wiki"
        />
        <TextField form={form} name="confluence.spaceKey" label="Space key" placeholder="ENG" />
        {values.confluence.source === "env" && allowEnv ? (
          <>
            <TextField
              form={form}
              name="confluence.usernameEnv"
              label="Username env variable (optional)"
              placeholder="SA_PRODUCT_CLUBCO_CONFLUENCE_USERNAME"
            />
            <TextField
              form={form}
              name="confluence.tokenEnv"
              label="Token env variable (optional)"
              placeholder="SA_PRODUCT_CLUBCO_CONFLUENCE_TOKEN"
              hint="Leave both empty for a space that is readable without signing in."
            />
          </>
        ) : (
          <>
            <TextField
              form={form}
              name="confluence.username"
              label="Email (optional, Cloud)"
              placeholder="you@acme.com"
            />
            <SecretField
              form={form}
              name="confluence.token"
              savedName="confluence.hasSavedToken"
              label="API token (optional)"
              placeholder="Leave empty for a public space"
            />
          </>
        )}
        {allowEnv ? (
          <TextField
            form={form}
            name="confluence.siteUrl"
            label="Public link URL (optional)"
            placeholder="https://acme.atlassian.net/wiki/spaces/ENG"
          />
        ) : null}
      </Section>

      <Section
        title="Jira"
        enabled={values.jira.enabled}
        onToggle={(next) => form.setValue("jira.enabled", next, { shouldDirty: true })}
        modeLabel={modeLabel}
        onTest={onTest ? () => onTest("jira") : undefined}
      >
        <TextField form={form} name="jira.baseUrl" label="Jira URL" placeholder="https://acme.atlassian.net" />
        <TextField form={form} name="jira.username" label="Email (optional, Cloud)" placeholder="you@acme.com" />
        <SecretField
          form={form}
          name="jira.token"
          savedName="jira.hasSavedToken"
          label="API or personal token"
        />
      </Section>

      <fieldset className="rounded-xl border border-border p-3">
        <legend className="px-1 text-xs font-medium">Keep browser values in</legend>
        <div className="mt-1 flex flex-col gap-1.5">
          {STORAGE_MODES.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input type="radio" value={item.id} {...form.register("mode")} />
              {item.label}
            </label>
          ))}
        </div>
        {values.mode === "passphrase" ? (
          <div className="mt-3">
            <label htmlFor="conn-passphrase" className="block text-xs font-medium">
              Passphrase{passphraseHeld ? " (leave empty to keep the current one)" : ""}
            </label>
            <input
              id="conn-passphrase"
              type="password"
              {...form.register("passphrase")}
              autoComplete="new-password"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-muted">
              Asked once per session. A forgotten passphrase means entering these values again.
            </p>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
