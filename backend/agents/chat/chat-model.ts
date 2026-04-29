import { ChatOllama } from "@langchain/ollama";

export const chatModel = new ChatOllama({
  model: process.env.OLLAMA_CHAT_MODEL,
  temperature: 0.5,
});
