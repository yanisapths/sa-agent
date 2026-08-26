import { createMiddleware } from "langchain";

import { SKILLS } from "./state";
import { CustomState, loadSkill } from "./load-skill";
import { writeSqlQuery } from "./write-sql-query";

export const skillsPrompt = SKILLS.map(
  (skill) => `- **${skill.name}**: ${skill.description}`,
).join("\n");

export const skillMiddleware = createMiddleware({
  name: "skillMiddleware",
  // stateSchema: CustomState,
  tools: [loadSkill, writeSqlQuery],
  wrapModelCall: async (request, handler) => {
    const skillsAddendum =
      `\n\n## Available Skills\n\n${skillsPrompt}\n\n` +
      "Use the load_skill tool when you need detailed information " +
      "about handling a specific type of request.";

    const newSystemPrompt = request.systemPrompt + skillsAddendum;

    return handler({
      ...request,
      systemPrompt: newSystemPrompt,
    });
  },
});
