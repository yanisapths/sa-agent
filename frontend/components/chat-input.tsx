"use client";

import { ArrowUp, PlusIcon, X, FileText } from "lucide-react";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { Button } from "./ui/Button";
import { useRef, useState, useCallback } from "react";
import Image from "next/image";
export interface Attachment {
  id: string;
  file: File;
  preview?: string;
  isImage: boolean;
}

interface ChatInputProps {
  onSend: (message: string, attachments: Attachment[]) => void;
  isLoading?: boolean;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
}

export const sendButtonVariants: Variants = {
  hidden: { opacity: 0, scale: 0.4, rotate: -15 },
  visible: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.4, rotate: -15 },
};

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
}: ChatInputProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!value.trim() && attachments.length === 0) || isLoading) return;
    onSend(value, attachments);
    onChange("");
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const canSend = value.trim().length > 0 || attachments.length > 0;

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

      <form onSubmit={handleSubmit}>
        <div className="relative rounded-2xl border border-[#716D65]/20 bg-white shadow-[6px_2px_35px_rgba(0,0,0,0.05)] overflow-hidden">
          <AnimatePresence>
            {attachments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-2 px-3 pt-3"
              >
                {attachments.map((att) => (
                  <motion.div
                    key={att.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="relative group"
                  >
                    {att.isImage ? (
                      <div className="relative rounded-lg overflow-hidden border border-black/10">
                        <Image
                          width={64}
                          height={64}
                          src={att.preview ?? ""}
                          alt={att.file.name}
                          className="w-16 h-16 object-cover block"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-muted/50 px-2.5 py-2 max-w-[180px]">
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

          <textarea
            placeholder={placeholder ?? "How can I help you today?"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="w-full min-h-[120px] resize-none border-0 bg-transparent outline-none ring-0 p-4 text-foreground placeholder:text-muted-foreground block"
            style={{ boxShadow: "none" }}
          />

          <div className="absolute left-3 bottom-3">
            <Button
              type="button"
              variant="icon"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files or images"
            >
              <PlusIcon size={18} />
            </Button>
          </div>

          <AnimatePresence>
            {canSend && (
              <motion.div
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
                  className="bg-pink-300 text-white hover:bg-pink-400 rounded-lg"
                >
                  <ArrowUp size={18} />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </form>
    </div>
  );
}
