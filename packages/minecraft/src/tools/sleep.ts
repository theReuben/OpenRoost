import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerSleep(server: McpServer, bot: BotManager): void {
  server.tool(
    "sleep",
    "Sleep in a nearby bed. Only works at night or during thunderstorms. Sleeping resets the phantom spawn timer (phantoms appear after 3 nights without sleep). Will search for a bed within the given radius and check for nearby hostiles before sleeping.",
    {
      radius: z.number().default(16).describe("Search radius for a bed"),
      forceUnsafe: z.boolean().default(false).describe("Sleep even if hostiles are nearby (risky)"),
    },
    async ({ radius, forceUnsafe }) => {
      try {
        // Check dimension — beds explode in the Nether and End
        const dimension = (bot.bot as any).game?.dimension ?? "";
        if (dimension.includes("nether") || dimension.includes("the_end")) {
          const wrapped = errorResponse(
            `Cannot sleep in ${dimension} — beds explode! Use a respawn anchor in the Nether instead.`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Check if it's time to sleep
        const canSleep = bot.isNight || bot.currentWeather === "thunder";
        if (!canSleep) {
          const wrapped = errorResponse(
            "Cannot sleep right now — it must be night or thundering.",
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Check for nearby hostiles
        if (!forceUnsafe) {
          const hostiles = bot.getNearbyEntities(16).filter((e) => e.type === "mob");
          if (hostiles.length > 0) {
            const closest = hostiles[0];
            const wrapped = errorResponse(
              `Cannot sleep — ${hostiles.length} hostile mob(s) nearby. Closest: ${closest.name} at ${closest.distance} blocks. Clear hostiles first or use forceUnsafe=true.`,
              bot.events
            );
            return {
              content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
            };
          }
        }

        // Find a bed block nearby
        const bedNames = [
          "white_bed", "orange_bed", "magenta_bed", "light_blue_bed",
          "yellow_bed", "lime_bed", "pink_bed", "gray_bed",
          "light_gray_bed", "cyan_bed", "purple_bed", "blue_bed",
          "brown_bed", "green_bed", "red_bed", "black_bed",
        ];

        const bedBlock = bot.bot.findBlock({
          matching: (block: any) => bedNames.includes(block.name),
          maxDistance: radius,
        });

        if (!bedBlock) {
          const wrapped = errorResponse(
            `No bed found within ${radius} blocks. Craft a bed (3 wool + 3 planks) or increase search radius.`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Navigate close to the bed if needed
        const dist = bot.bot.entity.position.distanceTo(bedBlock.position);
        if (dist > 3) {
          const { Movements, goals } = await import("mineflayer-pathfinder");
          const movements = new Movements(bot.bot);
          bot.bot.pathfinder.setMovements(movements);
          bot.bot.pathfinder.setGoal(
            new goals.GoalNear(
              bedBlock.position.x,
              bedBlock.position.y,
              bedBlock.position.z,
              2
            )
          );

          // Wait for arrival (max 10 seconds)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              bot.bot.pathfinder.setGoal(null as any);
              reject(new Error("Timed out walking to bed"));
            }, 10000);

            bot.bot.once("goal_reached", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }

        // Sleep in the bed
        let sleepTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bot.bot.sleep(bedBlock),
            new Promise<never>((_, reject) => {
              sleepTimer = setTimeout(
                () => reject(new Error("sleep timed out after 10s — server may not have confirmed")),
                10_000
              );
            }),
          ]);
        } finally {
          clearTimeout(sleepTimer);
        }

        // Update sleep tracking
        bot.lastSleepTick = bot.bot.time.age;

        // Wait for the server to wake us (morning or player interaction),
        // with a timeout in case the wake event never fires
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            resolve();
          }, 15000); // 15s safety timeout

          bot.bot.once("wake" as any, () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          {
            success: true,
            message: "Slept successfully. Phantom timer reset.",
            bedPosition: {
              x: Math.floor(bedBlock.position.x),
              y: Math.floor(bedBlock.position.y),
              z: Math.floor(bedBlock.position.z),
            },
            spawnPointSet: true,
            observation,
          },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Sleep failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
