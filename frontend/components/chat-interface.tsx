"use client";

import { useRef, useEffect, useState } from "react";
import {
  Attachment,
  ChatInput,
  sendButtonVariants,
} from "@/components/chat-input";
import { useChat } from "@/hooks/use-chat";
import { useGatewayModels } from "@/hooks/use-gateway-models";
import { useQuota } from "@/hooks/use-quota";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Button } from "./ui/Button";
import { Code, FileText } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CardStarField } from "./card-star-field/CardStarField";
import { ChatMessage } from "./chat-message";
import { isBusyStatus } from "@/lib/chat-stream";

const onboardingTags = [
  {
    icon: <Code size={14} />,
    message: "SQL query",
    textInput: "Give me SQL query for",
  },
  {
    icon: <FileText size={14} />,
    message: "API Spec",
    textInput: "Give me API specs for",
  },
];

export function ChatInterface() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, approvePlan, pinnedPhase } =
    useChat();
  const isLoading = isBusyStatus(status);
  const hasMessages = messages.length > 0;
  const models = useGatewayModels();
  const { refresh: refreshQuota } = useQuota();
  const { attached } = useWorkspace();
  const [input, setInput] = useState("");
  /** `null` means the server's configured default. */
  const [model, setModel] = useState<string | null>(null);

  const handleSend = (
    text: string,
    attachments: Attachment[],
    mentions: string[],
    phase?: string,
  ) => {
    if ((!text.trim() && attachments.length === 0) || isLoading) return;
    void sendMessage({
      text,
      attachments,
      mentions,
      model,
      phase,
      workspaceId: attached?.id,
      onSettled: refreshQuota,
    });
    setInput("");
  };

  const handlePromptHelpers = (textInput: string) => {
    setInput(textInput);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-transparent">
      <CardStarField />
      <main className="relative z-1 flex-1 overflow-y-auto">
        {hasMessages ? (
          <div className="max-w-6xl mx-auto py-6">
            {messages.map((message, i) => {
              const lastAssistant =
                i === messages.length - 1 && message.role === "assistant";
              return (
                <div key={message.id} className="msg-enter">
                  <ChatMessage
                    message={message}
                    isStreaming={
                      lastAssistant &&
                      (status === "streaming" || status === "submitted")
                    }
                    thoughtOpen={Boolean(pinnedPhase) || status === "waiting"}
                    waiting={status === "waiting" && lastAssistant}
                    onDecide={
                      status === "waiting" && lastAssistant
                        ? approvePlan
                        : undefined
                    }
                  />
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 msg-enter">
            <div className="w-full max-w-3xl mb-12">
              <ChatInput
                onSend={handleSend}
                isLoading={isLoading}
                value={input}
                onChange={setInput}
                onStop={stop}
                models={models}
                model={model}
                onModelChange={setModel}
                hasMessages={false}
              />
            </div>

            <div className="flex gap-2">
              {onboardingTags.map((tag, i) => (
                <AnimatePresence key={i}>
                  <motion.div
                    variants={sendButtonVariants}
                    style={{ animationDelay: `${i * 0.08}s` }}
                  >
                    <Button
                      variant="outline"
                      onClick={() => handlePromptHelpers(tag.textInput)}
                    >
                      {tag.icon}
                      {tag.message}
                    </Button>
                  </motion.div>
                </AnimatePresence>
              ))}
            </div>
          </div>
        )}
      </main>

      {hasMessages && (
        <div className="relative z-1 bg-background/50 backdrop-blur-sm p-4 msg-enter">
          <ChatInput
            onSend={handleSend}
            isLoading={isLoading}
            placeholder="Write a message..."
            value={input}
            onChange={setInput}
            onStop={stop}
            models={models}
            model={model}
            onModelChange={setModel}
            hasMessages
          />
        </div>
      )}
    </div>
  );
}
