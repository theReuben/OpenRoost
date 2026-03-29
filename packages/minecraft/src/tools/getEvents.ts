import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BotManager } from "../BotManager.js";

export function registerGetEvents(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_events",
    "Retrieve recent events (damage, chat, deaths, etc.) since the last check",
    {
      since: z
        .number()
        .optional()
        .describe("Game tick to fetch events from (default: since last call)"),
    },
    async ({ since }) => {
      const events =
        since !== undefined
          ? bot.events.getSince(since)
          : bot.events.getRecent();
      return {
        content: [
          { type: "text", text: JSON.stringify({ events }, null, 2) },
        ],
      };
    }
  );
}
