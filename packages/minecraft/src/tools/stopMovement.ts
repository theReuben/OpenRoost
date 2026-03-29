import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerStopMovement(server: McpServer, bot: BotManager): void {
  server.tool(
    "stop_movement",
    "Cancel any active movement or following task.",
    {},
    async () => {
      bot.bot.pathfinder.setGoal(null as any);
      const observation = bot.getObservation();
      const wrapped = wrapResponse(
        { success: true, observation },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
