"use client";

import { useRef, useEffect, useState } from "react";
import { Attachment, ChatInput } from "@/components/chat-input";
import { useGateway } from "@/features/gateway/GatewayProvider";
import { useChat } from "@/hooks/use-chat";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { GetStarted } from "@/features/onboarding/GetStarted";
import { type EffectiveCapabilities } from "@/features/product/capabilities";
import { useProduct } from "@/features/product/ProductProvider";
import { Button } from "./ui/Button";
import { Code, FileText, Search } from "lucide-react";
import { motion } from "framer-motion";
import { CardStarField } from "./card-star-field/CardStarField";
import { ChatMessage } from "./chat-message";
import { PlanPanel } from "./thought-panel";
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

function groundingLine(name: string | undefined, caps: EffectiveCapabilities): string {
  const sources = [
    caps.db === "on" ? "the live schema" : null,
    caps.docs === "on" ? "Confluence docs" : null,
    caps.repos === "on" ? "your repos" : null,
  ].filter((item): item is string => item !== null);
  const product = name ?? "this product";
  if (sources.length === 0) {
    return `Nothing is connected for ${product} yet, so answers are general.`;
  }
  const list =
    sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}`;
  return `Answers for ${product} are grounded in ${list}.`;
}

function ConnectionNotice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="mx-auto mb-2 max-w-3xl text-center text-xs text-amber-700 dark:text-amber-400" role="status">
      {text}
    </p>
  );
}

export function ChatInterface() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, approvePlan, submitFeedback, connectionNotice } =
    useChat();
  const { active, capabilities } = useProduct();
  const isLoading = isBusyStatus(status);
  const hasMessages = messages.length > 0;
  const lastMessage = messages.at(-1);
  const waitingForApproval =
    status === "waiting" && lastMessage?.role === "assistant";
  const { models, model, setModel, refreshQuota } = useGateway();
  const { attached } = useWorkspace();
  const [input, setInput] = useState("");
  /** Caveman is on until the human dismisses the chip. */
  const [caveman, setCaveman] = useState(true);

  const handleSend = (
    text: string,
    attachments: Attachment[],
    mentions: string[],
    phase?: string,
    style?: string,
  ) => {
    if ((!text.trim() && attachments.length === 0) || isLoading) return;
    void sendMessage({
      text,
      attachments,
      mentions,
      model,
      phase,
      style,
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
                    waiting={status === "waiting" && lastAssistant}
                    onFeedback={
                      message.feedback?.urls.user_score
                        ? (score, comment) =>
                            submitFeedback(
                              message.id,
                              score,
                              comment,
                              message.feedback?.runId,
                            )
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
                {groundingLine(active?.name, capabilities)}{" "}
                <br />
                Pick a starter, type{" "}
                <span className="font-medium text-foreground">/</span> for a
                specialist, or ask in your own words.
              </p>
            </div>
            <div className="w-full max-w-3xl mb-8">
              <ConnectionNotice text={connectionNotice} />
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
                caveman={caveman}
                onCavemanChange={setCaveman}
              />
            </div>

            <GetStarted />

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
          {waitingForApproval && (
            <div className="mx-auto mb-3 max-h-[40vh] max-w-6xl overflow-y-auto">
              <PlanPanel
                interrupt={lastMessage?.interrupt}
                waiting
                onDecide={approvePlan}
              />
            </div>
          )}
          <ConnectionNotice text={connectionNotice} />
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
            caveman={caveman}
            onCavemanChange={setCaveman}
          />
        </div>
      )}
    </div>
  );
}
