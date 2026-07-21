import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerSaveWaypoint(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "save_waypoint",
    {
      title: "Save Waypoint",
      description:
        "Remember a named location (persists across sessions). Coordinates default to " +
        'your current position — stand somewhere and save it as "home", "mine-entrance", ' +
        'etc. Re-saving a name updates it; pass remove: true to forget it. Use go_to ' +
        "with the waypoint name to return.",
      inputSchema: {
        name: z.string().describe('Waypoint name, e.g. "home"'),
        x: z.number().optional().describe("X (defaults to current position)"),
        y: z.number().optional().describe("Y (defaults to current position)"),
        z: z.number().optional().describe("Z (defaults to current position)"),
        note: z
          .string()
          .optional()
          .describe('What\'s here, e.g. "main base, chests + furnaces"'),
        remove: z.boolean().default(false).describe("Forget this waypoint instead"),
      },
      annotations: { destructiveHint: false },
    },
    async ({ name, x, y, z: zCoord, note, remove }) => {
      if (remove) {
        const removed = bot.memory.removeWaypoint(name);
        const wrapped = removed
          ? wrapResponse(
              { success: true, removed: name, waypointCount: bot.memory.waypointCount },
              bot.events
            )
          : errorResponse(`No waypoint named "${name}"`, bot.events);
        return toolResult(wrapped);
      }

      let position;
      if (x !== undefined && y !== undefined && zCoord !== undefined) {
        position = { x, y, z: zCoord };
      } else if (bot.isConnected) {
        const p = bot.bot.entity.position;
        position = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
      } else {
        return toolResult(
          errorResponse(
            "Not connected and no coordinates given — provide x/y/z",
            bot.events
          )
        );
      }

      const waypoint = bot.memory.setWaypoint(name, position, note);
      const wrapped = wrapResponse(
        { success: true, waypoint, waypointCount: bot.memory.waypointCount },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}
