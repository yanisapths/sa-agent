import { StateGraph, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state";
import { retrievalNode } from "./nodes/retrieval";
import { generationNode } from "./nodes/generation";
import { reviewNode } from "./nodes/review";

const workflow = new StateGraph(AgentState)
  .addNode("retrieval", retrievalNode)
  .addNode("generation", generationNode)
  .addNode("review", reviewNode)
  .addEdge("__start__", "retrieval")
  .addEdge("retrieval", "generation")
  .addEdge("generation", "review")
  .addEdge("review", "__end__");

export const chatAgent = workflow.compile({
  checkpointer: new MemorySaver(),
});
