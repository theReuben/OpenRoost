import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerRecallContainers(
  server: McpServer,
  bot: BotManager
): void {
  server.tool(
    "recall_containers",
    "Remember what was in containers (chests, furnaces, barrels) you've previously opened. Memory fades over time: recent containers have exact recall, older ones become fuzzy, and eventually only notable items (diamonds, netherite) are remembered.",
    {
      x: z.number().optional().describe("Recall a specific container at X coordinate"),
      y: z.number().optional().describe("Recall a specific container at Y coordinate"),
      z: z.number().optional().describe("Recall a specific container at Z coordinate"),
    },
    async ({ x, y, z: zCoord }) => {
      const currentTick = bot.bot.time?.age ?? 0;

      if (x !== undefined && y !== undefined && zCoord !== undefined) {
        const memory = bot.containerMemory.recallAt(
          { x, y, z: zCoord },
          currentTick
        );

        if (!memory) {
          const wrapped = wrapResponse(
            {
              found: false,
              message: "No memory of a container at that position.",
            },
            bot.events
          );
          return {
            content: [
              { type: "text", text: JSON.stringify(wrapped, null, 2) },
            ],
          };
        }

        const wrapped = wrapResponse(
          { found: true, container: memory },
          bot.events
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(wrapped, null, 2) },
          ],
        };
      }

      // Recall all containers
      const memories = bot.containerMemory.recall(currentTick);
      const wrapped = wrapResponse(
        {
          containers: memories,
          totalRemembered: memories.length,
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
