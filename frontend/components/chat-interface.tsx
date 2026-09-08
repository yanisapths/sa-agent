"use client";

import { useRef, useEffect, useState } from "react";
import { Attachment, ChatInput } from "@/components/chat-input";
import { useChat } from "@/hooks/use-chat";
import { useGatewayModels } from "@/hooks/use-gateway-models";
import { useQuota } from "@/hooks/use-quota";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Button } from "./ui/Button";
import { Code, FileText, Search } from "lucide-react";
import { motion } from "framer-motion";
import { CardStarField } from "./card-star-field/CardStarField";
import { ChatMessage } from "./chat-message";
import { isBusyStatus } from "@/lib/chat-stream";

const onboardingTags = [
  {
    icon: <Code size={14} />,
    message: "SQL query",
    textInput: "Write a SQL query against the live schema for ",
  },
  {
    icon: <FileText size={14} />,
    message: "API spec",
    textInput: "Give me the API specs for ",
  },
  {
    icon: <Search size={14} />,
    message: "Search docs",
    textInput: "Search the documentation for ",
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
            <div className="mb-8 max-w-xl text-center">
              <h1 className="text-2xl font-semibold tracking-tight">
                Start with a question
              </h1>
              <p className="mt-2 text-sm text-muted">
                Answers are grounded in the live schema and Mintlify docs.{" "}
                <br />
                Pick a starter, type{" "}
                <span className="font-medium text-foreground">/</span> for a
                specialist, or ask in your own words.
              </p>
            </div>
            <div className="w-full max-w-3xl mb-8">
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

            <div className="flex flex-wrap justify-center gap-2">
              {onboardingTags.map((tag, i) => (
                <motion.div
                  key={tag.message}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <Button
                    variant="outline"
                    onClick={() => handlePromptHelpers(tag.textInput)}
                  >
                    {tag.icon}
                    {tag.message}
                  </Button>
                </motion.div>
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
