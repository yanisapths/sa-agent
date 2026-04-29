import { agent } from "../rag/rag-model";
import { v4 as uuidv4 } from "uuid";

const threadId = uuidv4();
const config = { configurable: { thread_id: threadId } };

// Ask for a SQL query
const result = await agent.invoke(
  {
    messages: [
      {
        role: "user",
        content:
          "Write a SQL query to get a user's trait assessment progress. " +
          "Return how many questions they have answered (rows in trait_user_answer_log) " +
          "and the total number of questions in trait_question. Input is emp_id.",
      },
    ],
  },
  config,
);

// Print the conversation
for (const message of result.messages) {
  console.log(`${message.type}: ${message.content}`);
}
