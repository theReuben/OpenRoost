import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerWaitForEvents(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "wait_for_events",
    {
      title: "Wait For Events",
      description:
        "Idle attentively: block until an urgent event arrives (chat message, damage, " +
        "death, threat) or the timeout elapses, whichever comes first. Use this instead " +
        "of repeated get_events polling when you have nothing to do but want to react " +
        "quickly — e.g. while accompanying a player who might speak to you.",
      inputSchema: {
        timeoutSeconds: z
          .number()
          .min(1)
          .max(55)
          .default(25)
          .describe(
            "Maximum seconds to wait (capped at 55 to stay under client timeouts)"
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ timeoutSeconds }) => {
      const gotUrgent = await bot.events.waitForUrgent(timeoutSeconds * 1000);

      // wrapResponse drains the urgent events into the response envelope.
      const wrapped = wrapResponse(
        {
          interrupted: gotUrgent,
          message: gotUrgent
            ? "Urgent event(s) arrived — see urgentEvents. React now."
            : `Nothing urgent happened in ${timeoutSeconds}s. Re-assess and either act or wait again.`,
        },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}
