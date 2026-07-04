# Adding a New Game to OpenRoost

OpenRoost is built to grow: `@openroost/core` is game-agnostic, and each game
is its own package exposing an MCP server. Adding a game never means touching
core or the other games.

## What core gives you for free

| Primitive | What it does |
|-----------|--------------|
| `EventManager` | Ring buffer of game events with urgency levels; urgent events piggyback on every tool response so the agent reacts without polling |
| `TaskManager` | Async task model — long actions return task IDs the agent polls or cancels |
| `SkillLibrary` | Voyager-style persistent learning: strategies saved with outcomes, recalled by relevance |
| `JsonStore` | Durable JSON state with validation repair and an auto-save loop |
| `wrapResponse` / `toolResult` | Uniform response envelope: `{result, urgentEvents?}` emitted as both text and MCP structuredContent |

## Quick start

```bash
node scripts/create-game.mjs <game-name>   # e.g. factorio
npm install
npm run build
```

This scaffolds `packages/<game-name>/` with a compiling, bootable MCP server:
a `<Game>Manager` wired to all core primitives, `get_status` /
`save_skill` / `recall_skills` tools, persistence, and graceful shutdown.
The skill library works from day one — the agent starts learning your game
before you've written a single game-specific tool.

## Then make it real

1. **Connect** — implement `<Game>Manager.connect()` using whatever the game
   offers: a bot protocol library (Minecraft → Mineflayer), an RCON socket
   (Factorio), a modding API bridge (Stardew → SMAPI), or a REST plugin
   (Terraria → TShock).
2. **Perceive** — add observation tools first (`get_observation`-style
   snapshots, plus targeted queries). Mark them `readOnlyHint: true` so
   clients can auto-approve them; a co-op agent needs a fast perception loop.
3. **Act** — add intentional actions ("mine this block", "build here"), not
   input events ("press W") and not vague goals ("win the game"). Long
   actions create tasks and return the task ID immediately.
4. **React** — push events into `EventManager` with the right urgency.
   Urgent events (damage, chat, threats) reach the agent on its very next
   tool call, whatever that call is.
5. **Teach** — register a `gameplay-guide` MCP prompt covering survival
   priorities, tool patterns, and cooperation norms for your game
   (see `packages/minecraft/src/prompts.ts`).

## Conventions that keep games consistent

- **stdout is sacred** — it carries MCP JSON-RPC. All logging goes to
  `console.error`. If a library prints to stdout during init, suppress and
  restore (see the viewer handling in `packages/minecraft/src/index.ts`).
- **Every tool response** goes through `wrapResponse(...)` + `toolResult(...)`.
- **Annotations on every tool** — `readOnlyHint` for perception,
  `destructiveHint` for irreversible world changes, `openWorldHint` for tools
  that reach other human players.
- **Confirmation for consequential acts** — anything aimed at another human
  player (PvP, trades that can gut a teammate's stash) should ask via MCP
  elicitation when the client supports it (see `attackEntity.ts`).
- **Persistence via `JsonStore`** — subclass with your state shape and a
  validator; wire restore/save/auto-save in your manager.
- **Tests mock the MCP server** — a `registerTool` capture map is all you
  need (see any `__tests__/*.test.ts` in the minecraft package).

## Candidate games and their integration routes

| Game | Route | Co-op shape |
|------|-------|-------------|
| Luanti (Minetest) | Lua mod bridge or bot protocol | Same open-world co-op as Minecraft |
| Factorio | RCON + Lua API | Factory planning, logistics division of labor |
| Terraria | TShock REST plugin | Boss prep, building, exploration |
| Stardew Valley | SMAPI mod bridge | Farm chores, mining runs, gifting |
| Screeps | Official HTTP API | Fully autonomous play (the game *is* programmatic) |

Solo play works the same way — the agent's loop doesn't require a human in
the world, just goals. A standing prompt ("keep the base stocked with iron")
plus the task and skill systems is enough for unattended sessions.
