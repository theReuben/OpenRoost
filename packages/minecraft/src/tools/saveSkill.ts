import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerSaveSkill(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "save_skill",
    {
      title: "Save Skill",
      description:
        "Record a strategy that worked (or failed) in your persistent skill library. " +
        "Call this after completing a non-trivial task so the approach can be recalled " +
        "in future sessions. Saving an existing skill name updates it and records the outcome.",
      inputSchema: {
        name: z
          .string()
          .describe('Short kebab-case identifier, e.g. "branch-mine-diamonds"'),
        description: z
          .string()
          .optional()
          .describe("One-line summary of when this skill applies"),
        strategy: z
          .string()
          .optional()
          .describe("The step-by-step approach that worked"),
        tags: z
          .array(z.string())
          .optional()
          .describe('Retrieval tags, e.g. ["mining", "diamonds", "safety"]'),
        outcome: z
          .enum(["success", "failure"])
          .optional()
          .describe("Outcome of the attempt that prompted this save"),
        note: z
          .string()
          .optional()
          .describe("A lesson learned to append to the skill's notes"),
      },
      annotations: { destructiveHint: false },
    },
    async ({ name, description, strategy, tags, outcome, note }) => {
      const skill = bot.skills.save({
        name,
        description,
        strategy,
        tags,
        outcome,
        note,
      });
      const wrapped = wrapResponse(
        {
          success: true,
          skill,
          librarySize: bot.skills.size,
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
