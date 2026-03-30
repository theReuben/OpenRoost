import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetObservation(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_observation",
    "Get a snapshot of current state and surroundings (position, health, nearby blocks/entities)",
    {},
    async () => {
      const observation = bot.getObservation();
      const wrapped = wrapResponse(observation, bot.events);
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
