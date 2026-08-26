"use client";

import { Attachment, ChatInput } from "@/components/chat-input";
import { useVaultMentions } from "@/features/vault/useVaultMentions";
import { useState } from "react";

const STARTER = `{
  "type": "api_spec",
  "title": "",
  "method": "GET",
  "endpoint": "",
  "description": "Send a prompt to generate a spec."
}`;

export function SpecDesignAgent() {
  const mentions = useVaultMentions();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ id: string; text: string }[]>([]);
  const [spec, setSpec] = useState(STARTER);

  const handleSend = (text: string, attachments: Attachment[]) => {
    if (!text.trim() && attachments.length === 0) return;
    const names = attachments.map((item) => item.file.name);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: text.trim() || `Uploaded ${names.join(", ")}`,
      },
    ]);
    setSpec(
      JSON.stringify(
        {
          type: "api_spec",
          title: text.trim() || "Uploaded resources",
          method: "POST",
          endpoint: "/v1/example",
          description: text.trim() || "Stub spec from uploaded files",
          files: names,
        },
        null,
        2,
      ),
    );
    setInput("");
  };

  return (
    <section className="grid h-full min-h-0 grid-cols-1 md:grid-cols-2">
      <div className="flex min-h-0 flex-col border-b border-[#716D65]/15 md:border-r md:border-b-0">
        <h1 className="shrink-0 px-5 py-3 text-sm font-semibold">Chat panel</h1>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {messages.length === 0 ? (
            <p className="text-sm text-[#716D65]">
              Describe an API. Attach requirement docs or images. Results stay
              JSON only.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 pb-4">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className="rounded-xl bg-white px-3 py-2 text-sm shadow-[6px_2px_35px_rgba(0,0,0,0.05)]"
                >
                  {message.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 p-4">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            mentions={mentions}
            placeholder="Ask for a spec, or attach files..."
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-col bg-white">
        <h2 className="shrink-0 px-5 py-3 text-sm font-semibold">
          Generate spec results (JSON only)
        </h2>
        <pre className="min-h-0 flex-1 overflow-auto px-5 pb-5 font-mono text-xs leading-5 text-[#414958]">
          {spec}
        </pre>
      </div>
    </section>
  );
}
