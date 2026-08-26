// Starts `astro dev`, requests `/`, and checks the response actually has a body.
//
// Under astro >= 7.2.6 with @astrojs/cloudflare, workerd throws while resolving
// the layout's extracted <script> virtual module. The exception is uncaught, the
// render is abandoned, and the response arrives with an EMPTY body — status 200,
// zero bytes. Under astro <= 7.2.5 the same request returns real HTML.
//
// The trigger is a COLD Vite cache, which is why CI reproduces it every time and
// a second local run usually does not. Clear it first:
//
//     rm -rf node_modules/.vite .astro && npm run repro
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const PORT = 4331;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 120_000;

// The bug only shows on a cold cache, so guarantee one rather than trusting the
// caller to have cleared it.
for (const dir of ["node_modules/.vite", ".astro"]) {
  await rm(dir, { recursive: true, force: true });
}

const server = spawn(
  "npx",
  ["astro", "dev", "--port", String(PORT), "--host", "127.0.0.1"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    // astro >= 7.2 auto-detects an AI-agent shell and daemonizes `astro dev`,
    // which would detach the server from this script. Setting this (to any
    // value) keeps it in the foreground. A no-op in CI and in a normal shell.
    env: { ...process.env, ASTRO_DEV_BACKGROUND: "1" },
  },
);

let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverOutput += chunk;
    process.stdout.write(`[astro dev] ${chunk}`);
  });
}

const shutdown = () => {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
};
process.on("exit", shutdown);

const waitForServer = async () => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`astro dev did not answer on ${ORIGIN}/health within ${READY_TIMEOUT_MS}ms`);
};

await waitForServer();

// Retry rather than sampling once. A single empty response would only prove the
// request raced Vite's dependency-optimizer reload, which is transient and
// happens on every version. The regression is PERSISTENT: past 7.2.5 the page
// never renders, no matter how long you wait or how many times you ask.
const ATTEMPTS = 10;
const attempts = [];
let rendered = null;

for (let i = 1; i <= ATTEMPTS; i += 1) {
  const response = await fetch(`${ORIGIN}/page`);
  const body = await response.text();
  attempts.push({ n: i, status: response.status, length: body.length });
  if (/<h1>astro-mre<\/h1>/.test(body)) {
    rendered = { n: i, length: body.length };
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}

console.log("");
console.log("─".repeat(72));
console.log(`GET ${ORIGIN}/page`);
for (const a of attempts) {
  console.log(`  attempt ${String(a.n).padStart(2)}:  status ${a.status}  body ${a.length} bytes`);
}
console.log("─".repeat(72));

const unresolved = serverOutput.match(/Unable to resolve \[[^\]]*\]/g) ?? [];
if (unresolved.length > 0) {
  console.log("workerd failed to resolve:");
  for (const line of [...new Set(unresolved)]) {
    console.log(`  ${line}`);
  }
  console.log("─".repeat(72));
}

shutdown();

if (rendered === null) {
  console.error("");
  console.error(`FAIL: the page never rendered in ${ATTEMPTS} attempts over ~30s.`);
  console.error("      Every response was HTTP 200 with an empty body.");
  process.exit(1);
}

console.log("");
console.log(`PASS: the page rendered on attempt ${rendered.n} (${rendered.length} bytes).`);
process.exit(0);
