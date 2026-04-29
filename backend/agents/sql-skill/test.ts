import { chatAgent } from "../chat/agent";
import { v4 as uuidv4 } from "uuid";

const threadId = uuidv4();
const config = { configurable: { thread_id: threadId } };

const result = await chatAgent.invoke(
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

for (const message of result.messages) {
  console.log(`${message.type}: ${message.content}`);
}
