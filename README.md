# astro-mre

Reduction of an Astro **dev server** failure: from `astro@7.2.6`, an app using
`@astrojs/cloudflare` together with `@sentry/astro` and `@astrojs/svelte` serves
**HTTP 200 with a zero-byte body** for every SSR page.

Not an error page. Not a 500. An empty string.

```
expect(received).toMatch(/^\s*<!doctype html>/i)
Received string:  ""
```

`ISSUE.md` in this repo is the write-up for the Astro team.

## Status: honest scope

Two different things are described here. Please read this before using the repo.

| | Verified in the real app | Verified in this reduction |
|---|---|---|
| Empty 200 on the first request after a dep-optimizer reload | yes | **yes**, every run, every astro version |
| Empty 200 **permanently** — never recovers, every request, for 20+ minutes | yes, `astro >= 7.2.6` only | **no** |

This reduction reproduces the *transient* form on every version tested,
including 7.2.5. It does **not** yet reproduce the permanent form, which is the
actual regression. Something about the real app's scale or configuration makes
the broken state stick, and reducing that far has not succeeded yet.

So: `npm run repro` currently **passes** here (the page renders on attempt 2),
while in the real app on 7.2.6+ it never renders at all. The probe is written to
tell those two cases apart — see below.

## What is established, in the real app

- **Bisected**, against a cold cache, holding `@astrojs/cloudflare` at 14.2.5:
  `7.2.0` ok · `7.2.2` ok · `7.2.4` ok · `7.2.5` ok · **`7.2.6` broken** · `7.2.7` broken
- **The adapter is not the trigger.** `astro@7.2.0` + `adapter@14.2.5` renders fine.
  (`astro@7.2.7` + `adapter@14.1.3` is not a usable control — the dev server will
  not boot, which is the adapter's peer constraint.)
- **Three integrations are load-bearing together**: `@astrojs/cloudflare`,
  `@sentry/astro`, `@astrojs/svelte`. Removing *either* `@sentry/astro` or
  `@astrojs/svelte` makes the app render on every version.
- **workerd logs a resolution failure** for the layout's extracted `<script>`:
  ```
  [vite] Uncaught exception: workerd/jsg/.../value.h:1477: failed:
    remote.jsg.Error: Unable to resolve
    [src/layouts/BaseLayout.astro?astro&type=script&index=0&lang.ts]
  ```
  The exception is uncaught, so the render is abandoned and the response goes
  out empty.
- **The trigger is a cold Vite cache.** `rm -rf node_modules/.vite .astro`
  reproduces; a warm cache masks it. CI installs fresh every time, so CI always
  hits it; a developer machine after one run never does. That asymmetry is why
  the dependency bump that introduced this passed local verification and then
  failed every CI run afterwards.

## Running it

```sh
npm install
npm run repro
```

`scripts/repro.mjs`:

1. deletes `node_modules/.vite` and `.astro`, so the cache is always cold;
2. starts `astro dev`;
3. waits for readiness on `/health` — a route that renders **no layout**, so the
   probe cannot warm the page under test;
4. requests `/page` up to 10 times over ~30s.

It **fails only if the page never renders**. One empty response followed by a
good one is the transient reload race and is reported, not failed — that
distinction is the whole point, since a single sample cannot tell the two bugs
apart.

Pin a version to compare:

```sh
npm install --no-save astro@7.2.5 && npm run repro
npm install --no-save astro@7.2.7 && npm run repro
```

## CI

`.github/workflows/repro.yaml` runs the probe across `7.2.5`, `7.2.6` and
`7.2.7` on a fresh checkout with **no dependency cache**, and prints the
attempt-by-attempt table for each. A job goes red only on the permanent
failure.

## Layout

| Path | Why it is here |
|---|---|
| `astro.config.mjs` | the three load-bearing integrations |
| `src/layouts/Layout.astro` | a **bare** `<script>` that `import`s a module — Astro extracts it into `Layout.astro?astro&type=script&index=0&lang.ts`, the module workerd fails to resolve. `is:inline` avoids the bug but also stops the `import` working |
| `src/pages/page.astro` | the page under test |
| `src/pages/health.ts` | layout-free readiness route, so the probe cannot warm the page |
| `src/components/Counter.svelte` | gives `@astrojs/svelte` real work |
| `src/middleware.ts` | the app composes its own middleware with the one `@sentry/astro` injects |
| `scripts/repro.mjs` | the probe |
