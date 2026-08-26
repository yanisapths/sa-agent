import { ChatOllama } from "@langchain/ollama";

// export const chatModel = new ChatOllama({
//   model: process.env.OLLAMA_CHAT_MODEL,
//   temperature: 0.5,
// });
import { ChatAnthropic } from "@langchain/anthropic";

export const chatModel = new ChatAnthropic({});
