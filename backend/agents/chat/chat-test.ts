import { agent } from "../rag/rag-model";

const chat = async () => {
  let inputMessage = `List the apis endpoints`;

  let agentInputs = { messages: [{ role: "user", content: inputMessage }] };

  for await (const step of await agent.stream(agentInputs, {
    streamMode: "values",
  })) {
    const lastMessage = step.messages[step.messages.length - 1];
    console.log(lastMessage);
    console.log("-----\n");
  }
};

chat();
