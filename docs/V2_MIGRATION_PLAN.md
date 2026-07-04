# MCP SDK v2 Migration — Implementation Instructions

Instructions for an implementing agent (written to be executed without prior
context on this repo). Goal: migrate OpenRoost from `@modelcontextprotocol/sdk`
v1.29 to the v2 SDK generation released alongside the MCP 2026-07-28 spec.

## Before you start — hard preconditions

1. **Check that v2 is stable.** Run `npm view @modelcontextprotocol/server
   dist-tags`. If there is no stable (non-beta) release yet, STOP and report
   back — do not migrate production code to a beta unless explicitly asked.
   Stable was announced for 2026-07-28.
2. **Node 20+** is required by v2. Check `node --version`; also update the
   README prerequisite (currently says "Node.js 18+").
3. Read the official migration guide before writing any code:
   <https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html>
   and the server guide at <https://ts.sdk.modelcontextprotocol.io/v2/>.
   Where these instructions and the official guide disagree, the official
   guide wins — note the discrepancy in your PR/commit message.
4. Baseline: `npm install && npm run build && npm test` must be green before
   you change anything (179 tests at the time of writing). If not, fix or
   report first.

## What changes (summary of v1 → v2)

- Package split: `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server`
  (servers), `@modelcontextprotocol/core` (spec Zod schemas, only if needed).
  We only build servers; do not add the client package.
- Import paths: `@modelcontextprotocol/sdk/server/mcp.js` →
  `@modelcontextprotocol/server`; `@modelcontextprotocol/sdk/server/stdio.js`
  → `@modelcontextprotocol/server/stdio`.
- `inputSchema`/`outputSchema` must be wrapped schemas (`z.object({...})`),
  not raw shapes (`{...}`). Raw shapes still work but emit deprecation
  warnings — wrap them all.
- zod must be `^4.2.0` (repo already declares `^4.3.0` — keep it).
- `McpError` → `ProtocolError` / `SdkError` (we don't reference these today;
  nothing to do unless the codemod flags something).
- Handler `extra` param → `ctx` (`ctx.mcpReq.signal`, `ctx.mcpReq.send()`).
  Our handlers ignore the extra param today, EXCEPT the elicitation flow
  (see step 5).

## Repo touchpoints (exact, verified against current source)

- **34 source files** in `packages/minecraft/src/` import from
  `@modelcontextprotocol/sdk/...`: all 30 files in `tools/`, plus
  `index.ts`, `resources.ts`, `prompts.ts`.
- **`packages/minecraft/src/index.ts`** — `McpServer` + `StdioServerTransport`
  construction, `transport.onclose` shutdown hook.
- **`packages/minecraft/src/resources.ts`** — 7 `registerResource` calls and
  `wireResourceNotifications()`, which uses `server.server.sendResourceUpdated({uri})`.
- **`packages/minecraft/src/tools/attackEntity.ts`** lines ~45–47 — the only
  `server.server.*` usage in tools: `getClientCapabilities()?.elicitation`
  and `elicitInput({message, requestedSchema})` for the PvP confirmation.
- **`packages/minecraft/src/tools/saveSkill.ts` / `recallSkills.ts`** — the
  only two tools with `outputSchema` (raw shapes today; must become
  `z.object(...)`).
- **`scripts/create-game.mjs`** — generates new game packages; its embedded
  templates mirror all of the above and must be migrated in lockstep.
- **`packages/core/`** — has NO SDK dependency by design. Do not add one.
- **Tests** (`packages/minecraft/src/__tests__/`) — do not import the SDK;
  they mock the server as `{ registerTool, registerResource, server: {...} }`
  capture maps. They only break if call signatures change shape.

## Step-by-step

### 1. Swap dependencies

In `packages/minecraft/package.json`: remove `@modelcontextprotocol/sdk`,
add `@modelcontextprotocol/server` at the stable major. Keep `zod: ^4.3.0`.
Run `npm install`.

### 2. Run the codemod, then audit it

```bash
npx @modelcontextprotocol/codemod@latest v1-to-v2 packages/minecraft scripts
grep -rn '@mcp-codemod-error' packages/ scripts/   # every hit needs a manual fix
npx tsc --noEmit -p packages/minecraft
```

The codemod handles import renames and mechanical API renames. It does NOT
handle everything — audit its diff hunk by hunk rather than trusting it.

### 3. Wrap all schemas

In each of the 30 tool files, change:

```ts
inputSchema:
{
  message: z.string().describe("..."),
},
```

to:

```ts
inputSchema: z.object({
  message: z.string().describe("..."),
}),
```

Same for the two `outputSchema` blocks in `saveSkill.ts` and
`recallSkills.ts` (note `saveSkill.ts` exports `skillOutputShape`, which is
already a `z.object` — only the surrounding `outputSchema: { result: ...,
urgentEvents: ... }` raw shape needs wrapping). Handler callbacks keep
receiving parsed args destructured the same way; zero-arg tools
(`get_observation`, `check_inventory`, `get_time_weather`, `stop_movement`)
may now receive `ctx` as their single argument — they ignore their argument
today, so no change beyond what tsc demands.

### 4. Transport and server construction (`index.ts`)

Prefer the minimal-diff path: keep explicit `new McpServer(...)` +
`StdioServerTransport` from `@modelcontextprotocol/server/stdio` if v2 still
exports it (the migration guide says it does). Only switch to the
`serveStdio()` wrapper if `transport.onclose` has no v2 equivalent —
the shutdown path (`transport.onclose = () => shutdown(...)`) MUST keep
working: verify by starting the server, closing stdin, and confirming the
"[OpenRoost] Shutting down (MCP client disconnected)" stderr line appears
and the process exits 0.

### 5. Elicitation in `attackEntity.ts`

v1 code reaches into `server.server` for `getClientCapabilities()` and
`elicitInput()`. In v2, server-initiated requests go through the handler
context (`ctx.mcpReq.send(...)`) or a dedicated helper — check the v2 server
guide's elicitation section for the blessed API. Requirements to preserve:

- Only elicit when the client advertises the elicitation capability.
- `action !== "accept"` or `confirm !== true` → refuse the attack with the
  same error text (`"was not approved by the user"` — a test asserts it).
- Elicitation throwing → proceed with the attack (previous behavior).
- Mob targets never elicit.

Update the mock in `__tests__/phase3Tools.test.ts` (`createMockServer`'s
`server: { getClientCapabilities, elicitInput }`) to mirror whatever the v2
access path is, keeping all four PvP tests meaningful.

### 6. Resource update notifications (`resources.ts`)

`server.server.sendResourceUpdated({uri})` must be replaced with the v2
notification API (check the v2 server guide — likely a method on the
registered resource handle or on `McpServer` directly). The `.catch(() => {})`
swallow-errors behavior must be preserved: notification failures must never
crash the bot loop.

### 7. Prompts (`prompts.ts`)

`registerPrompt(name, {title, description}, cb)` — verify the v2 config
shape (v2 docs show an `arguments` array field; ours takes no arguments).
Keep title/description if supported.

### 8. Migrate the scaffolder templates

Apply every change from steps 1–7 to the corresponding template strings in
`scripts/create-game.mjs` (package.json deps, imports, schema wrapping,
transport, shutdown). Then prove it:

```bash
node scripts/create-game.mjs testgame
npm install && npm run build
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'; sleep 1) \
  | timeout 10 node packages/testgame/build/index.js | head -c 400
rm -rf packages/testgame openroost-testgame-state.json && npm install
```

The smoke test must print an `initialize` result JSON with
`"serverInfo":{"name":"openroost-testgame"...}`.

### 9. Verify

- `npm run build` — clean.
- `npm test` — all 179 tests pass. Fix tests only where the SDK surface
  they mock genuinely changed; do not weaken assertions.
- Run the same initialize smoke test against
  `packages/minecraft/build/index.js` (it logs a connection failure to
  stderr without a Minecraft server — that's fine; the JSON-RPC handshake
  on stdout is what matters).
- `grep -rn "modelcontextprotocol/sdk" packages/ scripts/` — zero hits.
- Update README: Node 20+ prerequisite; move "MCP SDK v2" from Roadmap to
  done; mention the SDK packages in the Development section if useful.

### 10. Optional follow-ups — SEPARATE commits, only if time permits

- **MCP Tasks extension**: 2026-07-28 moves Tasks to an extension
  (`io.modelcontextprotocol/tasks`). OpenRoost's TaskManager (task IDs,
  `get_task_status`, `cancel_task`) is a natural mapping. Investigate SDK
  support; if it shipped, expose our tasks through it *additively* — do not
  remove the existing polling tools; older clients rely on them.
- Do NOT attempt MCP Apps or stateless-core work in this migration.

## Commit conventions

- Branch: work on `claude/coop-videogame-agent-y0t5tp` unless told otherwise.
- Separate commits: (1) dependency swap + codemod + schema wrapping,
  (2) elicitation/notification/transport manual fixes, (3) scaffolder,
  (4) docs. Each commit must build and pass tests on its own.
- If you hit a v2 API that neither these instructions nor the official docs
  resolve, read the installed package's `.d.ts` files in `node_modules`
  (that's how the v1 signatures in this repo were verified) rather than
  guessing from training data.
