import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetSounds(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_sounds",
    "Get recent sounds heard nearby. Sounds are categorized by threat level (danger, warning, activity, animal, weather). Use this to detect threats you can't see — like a creeper hissing behind you or mining sounds from another player.",
    {
      category: z.string().optional().describe("Filter by category prefix (e.g. 'danger', 'warning', 'activity')"),
      limit: z.number().default(10).describe("Max number of recent sounds to return"),
    },
    async ({ category, limit }) => {
      const recent = bot.events.getRecent();
      let sounds = recent.filter((e) => e.type === "sound_heard");

      if (category) {
        sounds = sounds.filter((e) => {
          const cat = (e.data.category as string) ?? "";
          return cat.startsWith(category);
        });
      }

      sounds = sounds.slice(0, limit);

      const wrapped = wrapResponse(
        {
          sounds: sounds.map((e) => ({
            sound: e.data.sound ?? e.data.soundId,
            category: e.data.category,
            position: e.data.position,
            volume: e.data.volume,
            tick: e.tick,
          })),
          totalRecent: sounds.length,
          hasDangerSounds: sounds.some((e) => (e.data.category as string)?.startsWith("danger")),
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
