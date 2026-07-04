import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerRecallSkills(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "recall_skills",
    {
      title: "Recall Skills",
      description:
        "Search your persistent skill library for strategies relevant to a task. " +
        "Call this before starting a non-trivial task — a past session may already " +
        "have learned the best approach. Omit the query to list all skills.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Task description to match, e.g. "mine diamonds safely"'),
        limit: z
          .number()
          .default(5)
          .describe("Maximum number of skills to return"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const result = query
        ? {
            matches: bot.skills.recall(query, limit).map((s) => ({
              score: Math.round(s.score * 10) / 10,
              ...s.skill,
            })),
          }
        : { skills: bot.skills.list().slice(0, limit) };

      const wrapped = wrapResponse(
        {
          success: true,
          librarySize: bot.skills.size,
          ...result,
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
