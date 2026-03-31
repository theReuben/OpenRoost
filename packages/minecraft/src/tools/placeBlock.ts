import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

const FACE_VECTORS: Record<string, { x: number; y: number; z: number }> = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};

export function registerPlaceBlock(server: McpServer, bot: BotManager): void {
  server.tool(
    "place_block",
    "Place a block from inventory at a position.",
    {
      blockName: z.string().describe("Name of the block to place"),
      x: z.number().describe("Target X coordinate"),
      y: z.number().describe("Target Y coordinate"),
      z: z.number().describe("Target Z coordinate"),
      face: z
        .enum(["top", "bottom", "north", "south", "east", "west"])
        .default("top")
        .describe("Which face of the adjacent block to place against"),
    },
    async ({ blockName, x, y, z: zCoord, face }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;

        // Find the block in inventory
        const item = bot.bot.inventory.items().find((i: any) => i.name === blockName);
        if (!item) {
          const wrapped = errorResponse(
            `No ${blockName} in inventory`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Equip the block
        await bot.bot.equip(item, "hand");

        // The face vector points from the reference block toward the target position.
        // The reference block is adjacent to target, on the opposite side of the face.
        const fv = FACE_VECTORS[face];
        const referencePos = new Vec3(x - fv.x, y - fv.y, zCoord - fv.z);
        const referenceBlock = bot.bot.blockAt(referencePos);

        if (!referenceBlock || referenceBlock.name === "air") {
          const wrapped = errorResponse(
            `No solid reference block at ${referencePos.x}, ${referencePos.y}, ${referencePos.z} to place against`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        const faceVector = new Vec3(fv.x, fv.y, fv.z);
        let placeTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bot.bot.placeBlock(referenceBlock, faceVector),
            new Promise<never>((_, reject) => {
              placeTimer = setTimeout(
                () => reject(new Error("placeBlock timed out after 10s — server may not have confirmed placement")),
                10_000
              );
            }),
          ]);
        } finally {
          clearTimeout(placeTimer);
        }

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, placed: blockName, position: { x, y, z: zCoord }, observation },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Block placement failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
