import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetPlayerInfo(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "get_player_info",
    {
      title: "Get Player Info",
      description:
        "Get information about a specific online player.",
      inputSchema:
      {
        playerName: z.string().describe("Player to look up"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ playerName }) => {
      try {
        const player = bot.bot.players[playerName];
        if (!player) {
          const wrapped = wrapResponse(
            { online: false },
            bot.events
          );
          return toolResult(wrapped);
        }

        const result: Record<string, unknown> = {
          online: true,
          ping: player.ping,
        };

        if (player.entity) {
          const pos = player.entity.position;
          const dist = pos.distanceTo(bot.bot.entity.position);
          result.position = {
            x: Math.floor(pos.x),
            y: Math.floor(pos.y),
            z: Math.floor(pos.z),
          };
          result.distance = Math.round(dist * 10) / 10;
          // Player health is only visible at close range
          if (dist <= 6) {
            result.health = (player.entity as any).health ?? undefined;
          }
        }

        const wrapped = wrapResponse(result, bot.events);
        return toolResult(wrapped);
      } catch (err) {
        const wrapped = errorResponse(
          `Player info failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return toolResult(wrapped);
      }
    }
  );
}
