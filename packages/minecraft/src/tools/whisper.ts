import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerWhisper(server: McpServer, bot: BotManager): void {
  server.tool(
    "whisper",
    "Send a private message to a specific player via /msg.",
    {
      playerName: z.string().describe("Recipient player name"),
      message: z.string().describe("Message content"),
    },
    async ({ playerName, message }) => {
      bot.bot.chat(`/msg ${playerName} ${message}`);
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
