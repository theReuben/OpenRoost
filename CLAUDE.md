# OpenRoost

MCP servers that let Claude play videogames as a cooperative player.
`@openroost/core` is game-agnostic infrastructure; each game lives in its own
package under `packages/` exposing an MCP server over stdio.

## Commands

```bash
npm install            # workspace install
npm run build          # build all packages (tsc)
npm test               # vitest, all packages — must stay green
node scripts/create-game.mjs <name>     # scaffold a new game package
node scripts/validate-game.mjs <name>   # conformance-check a game package
```

## Architecture

- `packages/core` — EventManager (urgent events piggyback on every tool
  response), TaskManager (async actions return task IDs), SkillLibrary
  (persistent cross-session learning), JsonStore (durable state),
  wrapResponse/toolResult (response envelope). **Core never imports the MCP
  SDK or any game library.** Never add game-specific code here.
- `packages/minecraft` — reference implementation: BotManager wraps
  Mineflayer; 30 tools in `src/tools/`, one file per tool.
- `docs/ADDING_A_GAME.md` — full guide for new game packages.
- `docs/V2_MIGRATION_PLAN.md` — pending SDK v2 migration instructions.

## Hard rules

1. **stdout is the MCP wire.** Never `console.log` in server code — always
   `console.error`. If a library prints to stdout during init, suppress and
   restore around the call (see `startViewer` in
   `packages/minecraft/src/index.ts`).
2. **Every tool response** goes through `wrapResponse(...)` then
   `toolResult(...)` from `@openroost/core`. No hand-built `{content: [...]}`.
3. **Every tool** is registered with `server.registerTool(name, config, cb)`
   and carries `title` + `annotations` (`readOnlyHint: true` for perception,
   `destructiveHint: true` for irreversible world changes, `openWorldHint:
   true` for tools that reach other human players).
4. **Long actions never block**: create a task via `TaskManager`, return the
   task ID immediately; the agent polls `get_task_status`.
5. **Tests mock the MCP server** as a capture map (`registerTool` →
   handlers.set). Don't import the real SDK in tests. Copy the pattern from
   any `packages/minecraft/src/__tests__/*.test.ts`.
6. After changing a game package, run `node scripts/validate-game.mjs <name>`
   and `npm test`. Both must pass before committing.

## Adding a game — short version

`node scripts/create-game.mjs <name>` scaffolds a compiling, bootable
package (manager + get_status/save_skill/recall_skills tools + starter
tests). Then: implement `connect()`, add perception tools first
(read-only), then action tools, push events into EventManager, add a
`gameplay-guide` prompt. Full recipe: `docs/ADDING_A_GAME.md`. Validate with
`scripts/validate-game.mjs`.
