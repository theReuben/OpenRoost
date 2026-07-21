import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerStopMovement(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "stop_movement",
    {
      title: "Stop Movement",
      description:
        "Cancel any active movement or following task.",
      inputSchema:
      {},
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async () => {
      bot.bot.pathfinder.setGoal(null as any);
      const observation = bot.getObservation();
      const wrapped = wrapResponse(
        { success: true, observation },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}
