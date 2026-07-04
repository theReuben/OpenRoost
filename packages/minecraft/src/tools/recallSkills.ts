import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";
import { skillOutputShape } from "./saveSkill.js";

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
      outputSchema: {
        result: z.object({
          success: z.boolean(),
          librarySize: z.number(),
          matches: z
            .array(skillOutputShape.extend({ score: z.number() }))
            .optional(),
          skills: z
            .array(
              z.object({
                name: z.string(),
                description: z.string(),
                tags: z.array(z.string()),
                timesUsed: z.number(),
                successes: z.number(),
                failures: z.number(),
              })
            )
            .optional(),
        }),
        urgentEvents: z.array(z.record(z.string(), z.unknown())).optional(),
      },
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
      return toolResult(wrapped);
    }
  );
}
