"use client";

import { useRef, useEffect, useState } from "react";
import {
  Attachment,
  ChatInput,
  sendButtonVariants,
} from "@/components/chat-input";
import { useChat } from "@/hooks/use-chat";
import { Button } from "./ui/Button";
import { Code, FileText } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { ChatMessage, TypingIndicator } from "./chat-message";

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
  const { messages, sendMessage, status } = useChat();
  const isLoading = status === "streaming" || status === "submitted";
  const hasMessages = messages.length > 0;
  const [input, setInput] = useState("");

  const handleSend = (text: string, attachments: Attachment[]) => {
    if ((!text.trim() && attachments.length === 0) || isLoading) return;
    sendMessage({ text, attachments });
    setInput("");
  };

  const handlePromptHelpers = (textInput: string) => {
    setInput(textInput);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <main className="flex-1 overflow-y-auto">
        {hasMessages ? (
          <div className="max-w-6xl mx-auto py-6">
            {messages.map((message, i) => (
              <div key={message.id} className="msg-enter">
                <ChatMessage
                  message={message}
                  isStreaming={
                    status === "streaming" &&
                    i === messages.length - 1 &&
                    message.role === "assistant"
                  }
                />
              </div>
            ))}

            {status === "submitted" && <TypingIndicator />}

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
        <div className="bg-background/50 backdrop-blur-sm p-4 msg-enter">
          <ChatInput
            onSend={handleSend}
            isLoading={isLoading}
            placeholder="Write a message..."
            value={input}
            onChange={setInput}
          />
        </div>
      )}
    </div>
  );
}
