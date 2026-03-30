import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BotManager } from "../BotManager.js";

export function registerGetEvents(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_events",
    "Retrieve recent events since the last check. Filter by type to find specific events like sounds, damage, chat, weather changes, etc. Use type='sound_heard' with category filter to detect nearby threats.",
    {
      since: z
        .number()
        .optional()
        .describe("Game tick to fetch events from (default: since last call)"),
      type: z
        .string()
        .optional()
        .describe("Filter by event type (e.g. 'sound_heard', 'damage_taken', 'chat', 'weather_change', 'death')"),
      category: z
        .string()
        .optional()
        .describe("For sound_heard events: filter by category prefix (e.g. 'danger', 'warning', 'activity')"),
      limit: z
        .number()
        .optional()
        .describe("Max events to return (default: all)"),
    },
    async ({ since, type, category, limit }) => {
      let events =
        since !== undefined
          ? bot.events.getSince(since)
          : bot.events.getRecent();

      if (type) {
        events = events.filter((e) => e.type === type);
      }

      if (category) {
        events = events.filter((e) => {
          const cat = (e.data.category as string) ?? "";
          return cat.startsWith(category);
        });
      }

      if (limit !== undefined) {
        events = events.slice(0, limit);
      }

      const hasDangerSounds = events.some(
        (e) => e.type === "sound_heard" && (e.data.category as string)?.startsWith("danger")
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ events, count: events.length, hasDangerSounds }, null, 2),
          },
        ],
      };
    }
  );
}
