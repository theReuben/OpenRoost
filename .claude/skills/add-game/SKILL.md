---
name: add-game
description: Add support for a new game to OpenRoost. Use when asked to add, scaffold, integrate, or implement a new game package (e.g. "add Factorio support", "create a Terraria package", "make OpenRoost play X").
---

# Adding a new game package to OpenRoost

Follow these steps in order. Do not skip the validation steps — they catch
convention violations that break the MCP protocol at runtime.

## 1. Scaffold

```bash
node scripts/create-game.mjs <game-name>   # lowercase kebab-case
npm install
npm run build
npm test
```

All four must succeed before you write any game code. The scaffold already
includes: a `<Game>Manager` wired to core's EventManager/TaskManager/
SkillLibrary/JsonStore, `get_status` + `save_skill` + `recall_skills` tools,
starter tests, and graceful shutdown.

## 2. Implement the connection

Edit `packages/<name>/src/<Game>Manager.ts` → `connect()`. Pick the route:

| Game style | Route | Example |
|------------|-------|---------|
| Has a bot protocol library | Use it directly | Minecraft → mineflayer |
| Has RCON | RCON client + game console commands | Factorio |
| Has a modding API | Write/use a mod that bridges to HTTP/socket | Stardew → SMAPI |
| Has an HTTP API | Call it directly | Screeps |

Set `isConnected`, and push game happenings into `this.events.push({tick,
type, data, summary})` — urgent ones (damage, chat, death) reach the agent
on its next tool call automatically.

## 3. Add tools — perception first, then actions

One file per tool in `packages/<name>/src/tools/`, registered in
`tools/index.ts`. Copy the structure of an existing minecraft tool
(`packages/minecraft/src/tools/` — e.g. `scanArea.ts` for perception,
`goTo.ts` for an async action, `mineBlock.ts` for a world mutation).

Non-negotiable conventions per tool:

- `server.registerTool(name, { title, description, inputSchema, annotations }, cb)`
- snake_case tool name; Title Case title
- `annotations`: `{ readOnlyHint: true }` for perception; `{ destructiveHint:
  true }` for irreversible changes; `{ openWorldHint: true }` for anything
  reaching other human players
- Response: `const wrapped = wrapResponse(payload, game.events); return
  toolResult(wrapped);` — never hand-build `{content: [...]}`
- Long-running action: `const taskId = game.tasks.create("desc", onCancel)`,
  run the work in a detached async block that calls `tasks.complete()` or
  `tasks.fail()`, return the taskId immediately
- Errors: `return toolResult(errorResponse("message", game.events))`
- Log with `console.error` ONLY — `console.log` corrupts the MCP protocol

## 4. Add a test per tool

Extend `packages/<name>/src/__tests__/tools.test.ts` (the scaffold created
it with the mock-server pattern). Every tool gets at least: one happy-path
test asserting `parsed.result` shape, one failure-path test.

## 5. Teach the agent

Add a `gameplay-guide` prompt (copy the shape of
`packages/minecraft/src/prompts.ts`): survival/goal priorities, tool
patterns, cooperation norms for this game.

## 6. Validate — required before every commit

```bash
npm run build
npm test
node scripts/validate-game.mjs <game-name>
```

Fix every ERROR the validator reports. Treat WARNINGs as errors unless you
can say precisely why they don't apply.

## 7. Document

Add the game to the README architecture block and tool docs, and note its
integration route in `docs/ADDING_A_GAME.md`'s candidate table.

## If you get stuck

- API signatures: read the `.d.ts` files in `node_modules/@modelcontextprotocol/`
  — do not guess from memory.
- Convention questions: `CLAUDE.md` (rules) and `docs/ADDING_A_GAME.md`
  (rationale).
- Working examples of every pattern: `packages/minecraft/src/`.
