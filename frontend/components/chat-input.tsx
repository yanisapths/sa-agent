"use client";

import { ArrowUp, Folder, FolderGit2, PlusIcon, Square, X, FileText } from "lucide-react";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { Button } from "./ui/Button";
import { SlashCommandChip } from "./slash-command-chip";
import { SlashCommandMenu } from "./slash-command-menu";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Image from "next/image";
import {
  type SlashCommand,
  composeSlashMessage,
  consumeSlashToken,
  filterSlashCommands,
  findSlashCommand,
  matchSlashQuery,
  selectedPhase,
  withSlashCommand,
} from "./slash-commands";
import { ModelPicker } from "./model-picker";
import { type GatewayModel } from "@/features/gateway/types";
import { useChatMentions } from "@/features/artifacts/useChatMentions";
import { AddFolderDialog } from "@/features/workspace/AddFolderDialog";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";

export interface Attachment {
  id: string;
  file: File;
  preview?: string;
  isImage: boolean;
}

export interface MentionItem {
  token: string;
  label: string;
}

interface ChatInputProps {
  onSend: (
    message: string,
    attachments: Attachment[],
    mentions: string[],
    /** Phase specialist to pin, from a `/sa-*` or `/pvt-*` command. */
    phase?: string,
  ) => void;
  isLoading?: boolean;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
  /** Cancels the in-flight turn. Required for the stop button to appear. */
  onStop?: () => void;
  models?: GatewayModel[];
  model?: string | null;
  onModelChange?: (model: string | null) => void;
  hasMessages?: boolean;
}

export const sendButtonVariants: Variants = {
  hidden: { opacity: 0, scale: 0.4, rotate: -15 },
  visible: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.4, rotate: -15 },
};

const ONBOARDING_HINTS = [
  "Ask how a table or service actually works…",
  "Search the live docs for an endpoint or flow…",
  "Describe the SQL you need against the live schema…",
  "Ask for API specs for a feature or service…",
  "Type /jira plus a ticket key to load a user story…",
  "Type / to pin Discuss, Plan, Execute, or PVT…",
];

function useRotatingHint(enabled: boolean, intervalMs = 3800) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % ONBOARDING_HINTS.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return ONBOARDING_HINTS[index];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({
  onSend,
  isLoading,
  placeholder,
  value,
  onChange,
  onStop,
  models = [],
  model = null,
  onModelChange,
  hasMessages,
}: ChatInputProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [pickedMentions, setPickedMentions] = useState<string[]>([]);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    workspaces,
    attached,
    attach,
    detach,
    create,
  } = useWorkspace();
  const slashQuery = matchSlashQuery(value);
  const slashOptions =
    slashQuery === null
      ? []
      : filterSlashCommands(
          slashQuery,
          slashCommands.map((command) => command.token),
        );
  const mentionMatch = slashQuery !== null ? null : value.match(/@([^\s]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1] : null;
  const mentions = useChatMentions(mentionQuery);
  const mentionOptions =
    mentionQuery === null
      ? []
      : mentions
          .filter((item) => {
            const q = mentionQuery.toLowerCase();
            return (
              item.token.toLowerCase().includes(q) ||
              item.label.toLowerCase().includes(q)
            );
          })
          .slice(0, 8);

  const insertMention = (token: string) => {
    onChange(value.replace(/@[^\s]*$/, `${token} `));
    setPickedMentions((prev) =>
      prev.includes(token) ? prev : [...prev, token],
    );
  };

  const insertSlashCommand = (
    command: SlashCommand,
    fromValue: string = value,
  ) => {
    onChange(consumeSlashToken(fromValue));
    /** A turn runs one specialist, so a second phase replaces the first. */
    setSlashCommands((prev) => withSlashCommand(prev, command));
  };

  const handleInputChange = (next: string) => {
    const completed = next.match(/(?:^|\s)\/([A-Za-z][A-Za-z0-9-]*)\s$/);
    if (completed) {
      const command = findSlashCommand(completed[1]);
      if (
        command &&
        !slashCommands.some((item) => item.token === command.token)
      ) {
        insertSlashCommand(command, next);
        return;
      }
    }
    onChange(next);
  };

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const id = crypto.randomUUID();
      const isImage = file.type.startsWith("image/");
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachments((prev) => [
            ...prev,
            { id, file, preview: e.target?.result as string, isImage: true },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachments((prev) => [...prev, { id, file, isImage: false }]);
      }
    });
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const submit = () => {
    const message = composeSlashMessage(value, slashCommands);
    if ((!message && attachments.length === 0) || isLoading) return;
    onSend(message, attachments, pickedMentions, selectedPhase(slashCommands));
    onChange("");
    setAttachments([]);
    setSlashCommands([]);
    setPickedMentions([]);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (slashOptions[0]) {
        insertSlashCommand(slashOptions[0]);
        return;
      }
      if (mentionOptions[0]) {
        insertMention(mentionOptions[0].token);
        return;
      }
      submit();
    }
  };

  const canSend = value.trim().length > 0 || attachments.length > 0;
  const hasPills =
    attachments.length > 0 || slashCommands.length > 0 || Boolean(attached);
  const activePhase = slashCommands.find((command) => command.kind === "phase");
  const hasJira = slashCommands.some((command) => command.token === "/jira");
  const rotateOnboarding =
    !hasMessages && !placeholder && !activePhase && !hasJira;
  const rotatingHint = useRotatingHint(rotateOnboarding);
  const inputPlaceholder = hasJira
    ? "Ticket key, e.g. PROJ-123"
    : activePhase
      ? `What should ${activePhase.chipLabel} work on?`
      : (placeholder ?? rotatingHint);
  const showRotatingHint =
    rotateOnboarding && value.length === 0 && !isLoading;

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.csv,.docx,.xlsx"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        onClick={(e) => ((e.target as HTMLInputElement).value = "")}
      />

      <form onSubmit={handleSubmit} className="relative">
        <SlashCommandMenu
          commands={slashOptions}
          onSelect={insertSlashCommand}
          hasMessages={hasMessages}
        />
        {mentionOptions.length > 0 && (
          <ul
            role="listbox"
            aria-label="File mentions"
            className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-[6px_2px_35px_rgba(0,0,0,0.05)]"
          >
            {mentionOptions.map((item, index) => (
              <li key={item.token}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === 0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(item.token);
                  }}
                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/10"
                >
                  <span className="font-medium">{item.token}</span>
                  <span className="text-xs text-muted">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {folderMenuOpen && (
          <div className="absolute bottom-14 left-3 z-20 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            {workspaces.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">
                No project folders yet.
              </p>
            ) : (
              <ul className="max-h-48 overflow-y-auto py-1">
                {workspaces.map((ws) => (
                  <li key={ws.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/10"
                      onClick={() => {
                        attach(ws.id);
                        setFolderMenuOpen(false);
                      }}
                    >
                      <span className="font-medium truncate">{ws.name}</span>
                      <span className="text-[11px] text-muted truncate">
                        {ws.path}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="w-full border-t border-border px-3 py-2 text-left text-xs font-medium hover:bg-muted/10"
              onClick={() => {
                setFolderMenuOpen(false);
                setAddFolderOpen(true);
              }}
            >
              Choose in Finder…
            </button>
          </div>
        )}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface/80 shadow-[6px_2px_35px_rgba(0,0,0,0.08)] backdrop-blur-md">
          <AnimatePresence>
            {hasPills && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap items-center gap-2 px-3 pt-3"
              >
                {attached && (
                  <motion.div
                    key={attached.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-2.5 py-1.5 max-w-[240px]"
                  >
                    <FolderGit2 size={14} className="shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-xs font-medium truncate leading-tight">
                        {attached.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {attached.path}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={detach}
                      className="cursor-pointer ml-1 text-muted hover:text-foreground"
                      title="Stop working in this folder"
                      aria-label="Stop working in this folder"
                    >
                      <X size={12} strokeWidth={3} />
                    </button>
                  </motion.div>
                )}
                {slashCommands.map((command) => (
                  <motion.div
                    key={command.token}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                  >
                    <SlashCommandChip
                      command={command}
                      onRemove={() =>
                        setSlashCommands((prev) =>
                          prev.filter((item) => item.token !== command.token),
                        )
                      }
                    />
                  </motion.div>
                ))}
                {attachments.map((att) => (
                  <motion.div
                    key={att.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="relative group"
                  >
                    {att.isImage ? (
                      <div className="relative rounded-lg overflow-hidden border border-border">
                        <Image
                          width={64}
                          height={64}
                          src={att.preview ?? ""}
                          alt={att.file.name}
                          className="w-16 h-16 object-cover block"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2 max-w-[180px]">
                        <FileText
                          size={20}
                          className="text-muted-foreground shrink-0"
                        />
                        <div className="overflow-hidden">
                          <p className="text-xs font-medium truncate leading-tight">
                            {att.file.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatSize(att.file.size)}
                          </p>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="cursor-pointer absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground/70 hover:bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} strokeWidth={3} />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            {showRotatingHint && (
              <AnimatePresence mode="wait">
                <motion.span
                  key={inputPlaceholder}
                  aria-hidden
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  className="pointer-events-none absolute inset-x-4 top-4 text-muted"
                >
                  {inputPlaceholder}
                </motion.span>
              </AnimatePresence>
            )}
            <textarea
              placeholder={showRotatingHint ? "" : inputPlaceholder}
              aria-label={showRotatingHint ? inputPlaceholder : undefined}
              value={value}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              className="w-full min-h-[120px] resize-none border-0 bg-transparent outline-none ring-0 p-4 pb-14 text-foreground placeholder:text-muted block"
              style={{ boxShadow: "none" }}
            />
          </div>

          <div className="absolute left-3 bottom-3 flex items-center gap-1">
            <Button
              type="button"
              variant="icon"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files or images"
            >
              <PlusIcon size={18} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2 text-xs"
              onClick={() => setFolderMenuOpen((open) => !open)}
              title="Work in a folder"
            >
              <Folder size={14} />
              Work in a folder
            </Button>
            {onModelChange && (
              <ModelPicker
                models={models}
                model={model}
                onModelChange={onModelChange}
                disabled={isLoading}
              />
            )}
          </div>

          <AnimatePresence mode="wait">
            {isLoading && onStop ? (
              <motion.div
                key="stop"
                className="absolute bottom-3 right-3"
                variants={sendButtonVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
              >
                {/*
                  `type="button"` is load-bearing: the send button relies on the
                  form's implicit submit, so an untyped button here would send
                  another message instead of cancelling this one.
                */}
                <Button
                  type="button"
                  variant="icon"
                  size="sm"
                  onClick={onStop}
                  title="Stop generating"
                  aria-label="Stop generating"
                  className="bg-muted text-white hover:opacity-90 rounded-lg"
                >
                  <Square size={13} strokeWidth={3} />
                </Button>
              </motion.div>
            ) : (
              canSend && (
                <motion.div
                  key="send"
                  className="absolute bottom-3 right-3"
                  variants={sendButtonVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                >
                  <Button
                    variant="icon"
                    size="sm"
                    aria-label="Send message"
                    className="bg-light text-[#0a1333] hover:bg-light/90 rounded-lg"
                  >
                    <ArrowUp size={18} />
                  </Button>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </div>
      </form>
      <AddFolderDialog
        open={addFolderOpen}
        onClose={() => setAddFolderOpen(false)}
        onCreate={async (name, path) => {
          await create({ name, path });
        }}
      />
    </div>
  );
}
