import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, ItemStack } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerInteractBlock(server: McpServer, bot: BotManager): void {
  server.tool(
    "interact_block",
    "Interact with a block (open chest, press button, use furnace, open door).",
    {
      x: z.number().describe("Block X coordinate"),
      y: z.number().describe("Block Y coordinate"),
      z: z.number().describe("Block Z coordinate"),
    },
    async ({ x, y, z: zCoord }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        const block = bot.bot.blockAt(new Vec3(x, y, zCoord));

        if (!block || block.name === "air") {
          const wrapped = errorResponse("No block at that position", bot.events);
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        let activateTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bot.bot.activateBlock(block),
            new Promise<never>((_, reject) => {
              activateTimer = setTimeout(
                () => reject(new Error("activateBlock timed out after 10s — server may not have responded")),
                10_000
              );
            }),
          ]);
        } finally {
          clearTimeout(activateTimer);
        }

        // Check if it opened a container window
        let containerContents: ItemStack[] | undefined;
        const window = (bot.bot as any).currentWindow;
        if (window) {
          containerContents = window.containerItems().map((item: any) => ({
            name: item.name,
            count: item.count,
            slot: item.slot,
          }));
        }

        const observation = bot.getObservation();
        const result: Record<string, unknown> = {
          success: true,
          blockInteracted: block.name,
          observation,
        };
        if (containerContents) {
          result.containerContents = containerContents;

          // Record in container memory
          const currentTick = bot.bot.time?.age ?? 0;
          bot.containerMemory.record(
            { x, y, z: zCoord },
            block.name,
            containerContents,
            currentTick
          );
        }

        const wrapped = wrapResponse(result, bot.events);
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Interact failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
