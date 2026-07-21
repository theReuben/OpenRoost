import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerListWaypoints(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "list_waypoints",
    {
      title: "List Waypoints",
      description:
        "List all remembered locations with their distance from your current position " +
        "(nearest first). Check this when you need to find home, storage, or any place " +
        "saved in a previous session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const here = bot.isConnected ? bot.bot.entity.position : null;
      const waypoints = bot.memory.listWaypoints().map((wp) => ({
        ...wp,
        distance: here
          ? Math.round(
              Math.hypot(
                wp.position.x - here.x,
                wp.position.y - here.y,
                wp.position.z - here.z
              ) * 10
            ) / 10
          : null,
      }));
      if (here) {
        waypoints.sort(
          (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)
        );
      }

      const wrapped = wrapResponse(
        { waypoints, count: waypoints.length },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}
