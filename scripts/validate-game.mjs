#!/usr/bin/env node
/**
 * Conformance checker for OpenRoost game packages.
 *
 * Usage: node scripts/validate-game.mjs <game-name>
 *
 * Verifies the conventions that keep game packages consistent and — for the
 * stdout rules — keep the MCP protocol intact at runtime. Exits non-zero on
 * any ERROR. Run this after every change to a game package.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";

const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/validate-game.mjs <game-name>");
  process.exit(1);
}
const root = join(process.cwd(), "packages", name);
if (!existsSync(root)) {
  console.error(`ERROR packages/${name} does not exist`);
  process.exit(1);
}

let errors = 0;
let warnings = 0;
const err = (msg) => { console.error(`  ERROR ${msg}`); errors++; };
const warn = (msg) => { console.error(`  WARN  ${msg}`); warnings++; };
const ok = (msg) => console.error(`  ok    ${msg}`);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "__tests__") yield* sourceFiles(p);
    else if (entry.isFile() && p.endsWith(".ts")) yield p;
  }
}

// ── 1. package.json shape ──
console.error("package.json");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
if (pkg.name !== `@openroost/${name}`) err(`name is "${pkg.name}", expected "@openroost/${name}"`);
else ok(`name @openroost/${name}`);
const deps = pkg.dependencies ?? {};
if (!deps["@openroost/core"]) err("missing dependency @openroost/core");
else ok("depends on @openroost/core");
if (!Object.keys(deps).some((d) => d.startsWith("@modelcontextprotocol/"))) {
  err("missing an @modelcontextprotocol/* dependency");
} else ok("depends on the MCP SDK");
if (deps.zod && !/\^?4\./.test(deps.zod)) err(`zod "${deps.zod}" — must be ^4.x to match the SDK`);

// ── 2. Source conventions ──
console.error("source conventions");
const srcDir = join(root, "src");
let stdoutViolations = 0;
let handRolledContent = 0;
for (const file of sourceFiles(srcDir)) {
  const src = readFileSync(file, "utf-8");
  const rel = file.slice(root.length + 1);
  for (const [i, line] of src.split("\n").entries()) {
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
    if (/console\.log\(/.test(line)) {
      err(`${rel}:${i + 1} console.log — stdout carries MCP JSON-RPC; use console.error`);
      stdoutViolations++;
    }
    if (/process\.stdout\.write\(/.test(line) && !/origWrite|\(\(\) => true\)/.test(src)) {
      warn(`${rel}:${i + 1} process.stdout.write — only allowed for suppress-and-restore around noisy library init`);
    }
  }
  if (/return\s*\{\s*\n?\s*content:\s*\[/.test(src)) {
    warn(`${rel} hand-builds a {content: [...]} response — use wrapResponse + toolResult from @openroost/core`);
    handRolledContent++;
  }
}
if (stdoutViolations === 0) ok("no console.log in server sources");
if (handRolledContent === 0) ok("all responses go through toolResult");

// ── 3. Tool registration conventions ──
console.error("tool conventions");
const toolsDir = join(srcDir, "tools");
if (!existsSync(toolsDir)) {
  err("no src/tools/ directory");
} else {
  let toolFiles = 0;
  for (const file of sourceFiles(toolsDir)) {
    const src = readFileSync(file, "utf-8");
    if (!src.includes("registerTool(")) continue; // index.ts etc.
    toolFiles++;
    const rel = file.slice(root.length + 1);
    if (/\bserver\.tool\(/.test(src)) err(`${rel} uses deprecated server.tool() — use registerTool`);
    if (!/title:/.test(src)) err(`${rel} tool config missing title`);
    if (!/annotations:/.test(src)) err(`${rel} tool config missing annotations (readOnlyHint/destructiveHint/openWorldHint)`);
    if (!/toolResult\(/.test(src)) err(`${rel} does not use toolResult() for responses`);
    const nameMatch = src.match(/registerTool\(\s*\n?\s*"([^"]+)"/);
    if (nameMatch && !/^[a-z][a-z0-9_]*$/.test(nameMatch[1])) {
      err(`${rel} tool name "${nameMatch[1]}" is not snake_case`);
    }
  }
  if (toolFiles === 0) err("no tools registered under src/tools/");
  else ok(`${toolFiles} tool files pass registration checks`);
  const hasSkills =
    existsSync(join(toolsDir, "saveSkill.ts")) &&
    existsSync(join(toolsDir, "recallSkills.ts"));
  if (!hasSkills) warn("no save_skill/recall_skills tools — the agent won't learn this game across sessions");
  else ok("skill library tools present");
}

// ── 4. Tests exist ──
console.error("tests");
const testDir = join(srcDir, "__tests__");
if (!existsSync(testDir) || readdirSync(testDir).length === 0) {
  warn("no src/__tests__/ — every tool needs at least a happy-path and a failure-path test");
} else ok("test directory present");

// ── 5. Build ──
console.error("build");
try {
  execSync(`npm run build -w packages/${name}`, { stdio: "pipe" });
  ok("tsc build clean");
} catch (e) {
  err(`build failed:\n${e.stdout?.toString().slice(-2000) ?? e.message}`);
}

// ── 6. MCP handshake smoke test ──
console.error("MCP handshake");
const entry = join(root, "build", "index.js");
if (!existsSync(entry)) {
  err("build/index.js missing — cannot smoke-test");
  finish();
} else {
  const child = spawn("node", [entry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OPENROOST_STATE_FILE: `/tmp/openroost-validate-${name}.json` },
  });
  let out = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  child.stdout.on("data", (d) => {
    out += d.toString();
    if (out.includes('"serverInfo"')) child.kill("SIGTERM");
  });
  child.on("close", () => {
    clearTimeout(timer);
    let parsedOk = false;
    for (const line of out.split("\n").filter(Boolean)) {
      try {
        const msg = JSON.parse(line);
        if (msg.result?.serverInfo) {
          parsedOk = true;
          ok(`initialize handshake ok (server "${msg.result.serverInfo.name}")`);
        }
      } catch {
        err(`non-JSON bytes on stdout corrupt the MCP protocol: ${JSON.stringify(line.slice(0, 120))}`);
      }
    }
    if (!parsedOk && errors === 0) err("no initialize result received from the server");
    finish();
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "openroost-validator", version: "0" },
      },
    }) + "\n"
  );
}

function finish() {
  console.error(
    `\n${errors} error(s), ${warnings} warning(s) — packages/${name} ${errors ? "FAILED" : "passed"}`
  );
  process.exit(errors ? 1 : 0);
}
