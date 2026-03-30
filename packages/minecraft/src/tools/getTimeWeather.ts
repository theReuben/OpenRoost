import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

/** Convert Minecraft time-of-day ticks to a human-readable phase. */
function getTimePhase(timeOfDay: number): string {
  if (timeOfDay >= 0 && timeOfDay < 6000) return "morning";
  if (timeOfDay >= 6000 && timeOfDay < 12000) return "afternoon";
  if (timeOfDay >= 12000 && timeOfDay < 13000) return "dusk";
  if (timeOfDay >= 13000 && timeOfDay < 18000) return "night";
  if (timeOfDay >= 18000 && timeOfDay < 23000) return "midnight";
  return "dawn";
}

/** Get the moon phase name (0-7 cycle). */
function getMoonPhase(dayCount: number): string {
  const phases = [
    "full_moon", "waning_gibbous", "third_quarter", "waning_crescent",
    "new_moon", "waxing_crescent", "first_quarter", "waxing_gibbous",
  ];
  return phases[dayCount % 8];
}

export function registerGetTimeWeather(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_time_weather",
    "Get current time of day, weather, moon phase, and sleep status. Check this before deciding whether to explore, build, or seek shelter. Warns about phantom risk if you haven't slept in 3+ nights.",
    {},
    async () => {
      const time = bot.bot.time;
      const timeOfDay = time.timeOfDay;
      const dayCount = Math.floor(time.age / 24000);
      const ticksSinceSleep = bot.lastSleepTick >= 0
        ? (time.age - bot.lastSleepTick)
        : time.age;
      const nightsWithoutSleep = Math.floor(ticksSinceSleep / 24000);

      const wrapped = wrapResponse(
        {
          time: {
            timeOfDay,
            phase: getTimePhase(timeOfDay),
            dayCount,
            totalTicks: time.age,
            isNight: bot.isNight,
          },
          weather: {
            current: bot.currentWeather,
            isRaining: bot.bot.isRaining,
            canSleepNow: bot.isNight || bot.currentWeather === "thunder",
          },
          moon: {
            phase: getMoonPhase(dayCount),
          },
          sleep: {
            lastSleepTick: bot.lastSleepTick,
            ticksSinceSleep,
            nightsWithoutSleep,
            phantomRisk: nightsWithoutSleep >= 3,
            recommendation: nightsWithoutSleep >= 3
              ? "URGENT: Sleep immediately to reset phantom timer!"
              : nightsWithoutSleep >= 2
                ? "Consider sleeping soon to avoid phantoms."
                : "Sleep status OK.",
          },
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
