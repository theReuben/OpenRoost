#!/usr/bin/env node
/**
 * OpenRoost Autopilot — unattended solo play.
 *
 * Drives Claude against the OpenRoost Minecraft MCP server in a session
 * loop using the Claude Agent SDK. Each session starts fresh; continuity
 * comes from OpenRoost's persistent memory (skill library, waypoints,
 * journal), so the bot picks up its own projects where it left off.
 *
 * Usage:
 *   node scripts/autopilot.mjs "keep us stocked with iron and food"
 *   AUTOPILOT_SESSIONS=1 node scripts/autopilot.mjs "build a starter base"
 *
 * Requirements:
 *   - npm run build (the MCP server runs from packages/minecraft/build/)
 *   - A running Minecraft server (MC_HOST/MC_PORT/MC_USERNAME as usual)
 *   - Claude Code auth: `claude` login or ANTHROPIC_API_KEY
 *
 * Environment:
 *   AUTOPILOT_GOALS           Standing goals (alternative to CLI args)
 *   AUTOPILOT_MODEL           Model override (default: Claude Code's default)
 *   AUTOPILOT_MAX_TURNS       Max agentic turns per session (default 150)
 *   AUTOPILOT_SESSIONS        Number of sessions to run, 0 = forever (default 0)
 *   AUTOPILOT_SESSION_DELAY   Seconds between sessions (default 30)
 *   AUTOPILOT_MAX_BUDGET_USD  Per-session cost cap (optional)
 *   MC_HOST / MC_PORT / MC_USERNAME / MC_VERSION   Passed to the MCP server
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(repoRoot, "packages", "minecraft", "build", "index.js");

const goals =
  process.argv.slice(2).join(" ").trim() ||
  process.env.AUTOPILOT_GOALS ||
  "";

if (goals === "--help" || goals === "-h" || goals === "") {
  console.error(`OpenRoost Autopilot — unattended solo play

Usage: node scripts/autopilot.mjs "<standing goals>"

Example goals:
  "Survive, build up a base, and keep the chests stocked with iron, food, and torches"
  "Explore and map the area around spawn; save waypoints for anything interesting"

See the header of this file for environment variables.`);
  process.exit(goals === "" ? 1 : 0);
}

if (!existsSync(serverEntry)) {
  console.error("[autopilot] packages/minecraft/build/index.js not found — run: npm run build");
  process.exit(1);
}

const MAX_TURNS = parseInt(process.env.AUTOPILOT_MAX_TURNS ?? "150", 10);
const SESSIONS = parseInt(process.env.AUTOPILOT_SESSIONS ?? "0", 10);
const SESSION_DELAY = parseInt(process.env.AUTOPILOT_SESSION_DELAY ?? "30", 10);
const MAX_BUDGET = process.env.AUTOPILOT_MAX_BUDGET_USD
  ? parseFloat(process.env.AUTOPILOT_MAX_BUDGET_USD)
  : undefined;

const SYSTEM_PROMPT = `You are an autonomous cooperative Minecraft player, playing unattended via OpenRoost MCP tools. No human is watching in real time; never ask questions or wait for permission — decide and act.

Standing goals (in priority order after survival):
${goals}

Session discipline:
1. Start with the ritual: read_journal, list_waypoints, recall_skills, then get_observation.
2. Follow the survival priorities from the gameplay guide: don't die, stay fed, sleep, maintain tools, then goals.
3. Work the standing goals steadily. Prefer many small completed steps over one grand plan.
4. Persist everything future sessions need: save_waypoint for places, write_journal for project state, save_skill for strategies (successes AND failures).
5. If other players are online, be a good teammate: respond to chat, don't take their stuff, help when asked — the standing goals yield to direct player requests.
6. Use wait_for_events when there is genuinely nothing to do.
7. Before your turn budget runs out, wind down cleanly: get somewhere safe, write_journal with exact state and next steps, then summarize what you accomplished.

If the bot is not connected to Minecraft (tools report connection errors), wait_for_events once, retry get_observation a couple of times, and if still disconnected end the session with a journal-free summary saying so.`;

const label = (n) => `[autopilot session ${n}]`;

function printMessage(n, m) {
  // Defensive: log the useful parts of SDK messages without assuming exact shapes.
  if (m.type === "system" && m.subtype === "init") {
    console.error(`${label(n)} started (session ${m.session_id ?? "?"}, model ${m.model ?? "?"})`);
  } else if (m.type === "assistant") {
    for (const block of m.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) {
        console.error(`${label(n)} claude: ${block.text.trim()}`);
      } else if (block.type === "tool_use") {
        console.error(`${label(n)} tool: ${block.name}(${JSON.stringify(block.input ?? {}).slice(0, 160)})`);
      }
    }
  } else if (m.type === "result") {
    const cost = m.total_cost_usd !== undefined ? ` cost=$${m.total_cost_usd.toFixed(4)}` : "";
    console.error(`${label(n)} finished: ${m.subtype ?? "done"} turns=${m.num_turns ?? "?"}${cost}`);
  }
}

let stopping = false;
process.on("SIGINT", () => {
  console.error("[autopilot] SIGINT — finishing current session then stopping");
  stopping = true;
});

async function runSession(n) {
  const q = query({
    prompt:
      "New unattended session. Run your session startup ritual, then pursue the standing goals. " +
      "Wind down cleanly before your turn budget is exhausted.",
    options: {
      systemPrompt: SYSTEM_PROMPT,
      ...(process.env.AUTOPILOT_MODEL ? { model: process.env.AUTOPILOT_MODEL } : {}),
      maxTurns: MAX_TURNS,
      ...(MAX_BUDGET !== undefined ? { maxBudgetUsd: MAX_BUDGET } : {}),
      cwd: repoRoot,
      // Only the game tools — no filesystem, shell, or web access.
      mcpServers: {
        minecraft: {
          type: "stdio",
          command: process.execPath,
          args: [serverEntry],
          env: {
            MC_HOST: process.env.MC_HOST ?? "127.0.0.1",
            MC_PORT: process.env.MC_PORT ?? "25565",
            MC_USERNAME: process.env.MC_USERNAME ?? "ClaudeBot",
            ...(process.env.MC_VERSION ? { MC_VERSION: process.env.MC_VERSION } : {}),
            ...(process.env.OPENROOST_STATE_FILE
              ? { OPENROOST_STATE_FILE: process.env.OPENROOST_STATE_FILE }
              : {}),
          },
        },
      },
      strictMcpConfig: true,
      settingSources: [],
      permissionMode: "dontAsk", // unattended: non-allowlisted tools are denied, never prompted
      allowedTools: ["mcp__minecraft__*"],
      disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task"],
    },
  });

  for await (const message of q) {
    printMessage(n, message);
  }
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

console.error(`[autopilot] goals: ${goals}`);
console.error(`[autopilot] sessions: ${SESSIONS === 0 ? "unlimited" : SESSIONS}, max turns/session: ${MAX_TURNS}`);

let n = 0;
while (!stopping && (SESSIONS === 0 || n < SESSIONS)) {
  n += 1;
  try {
    await runSession(n);
  } catch (err) {
    console.error(`${label(n)} error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (stopping || (SESSIONS !== 0 && n >= SESSIONS)) break;
  console.error(`[autopilot] next session in ${SESSION_DELAY}s (Ctrl-C to stop)`);
  await sleep(SESSION_DELAY);
}
console.error(`[autopilot] done after ${n} session(s)`);
