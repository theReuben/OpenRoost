import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerWriteJournal(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "write_journal",
    {
      title: "Write Journal",
      description:
        "Record what's going on for future sessions: current project, agreements with " +
        'players, state of the base ("building a castle at the north waypoint with Alex; ' +
        'walls done, need 3 more stacks of stone"). Write an entry whenever the situation ' +
        "changes meaningfully — your future self starts with no other context.",
      inputSchema: {
        text: z.string().describe("The note to record"),
        tags: z
          .array(z.string())
          .optional()
          .describe('Optional tags for filtering, e.g. ["project", "base"]'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ text, tags }) => {
      const entry = bot.memory.addJournal(text, tags ?? []);
      const wrapped = wrapResponse(
        { success: true, entry, journalLength: bot.memory.journalLength },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}

export function registerReadJournal(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "read_journal",
    {
      title: "Read Journal",
      description:
        "Read recent journal entries from this and past sessions. Do this at the start " +
        "of a session (and before resuming any project) to pick up where you left off.",
      inputSchema: {
        limit: z.number().default(20).describe("Max entries to return (newest last)"),
        tag: z.string().optional().describe("Only entries with this tag"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, tag }) => {
      const entries = bot.memory.recentJournal(limit, tag);
      const wrapped = wrapResponse(
        { entries, count: entries.length, totalJournalLength: bot.memory.journalLength },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}
