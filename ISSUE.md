# Dev server returns HTTP 200 with an empty body from astro 7.2.6 (`@astrojs/cloudflare` + `@sentry/astro` + `@astrojs/svelte`)

### Astro Info

```
astro                 7.2.5 (works) / 7.2.6 (broken) / 7.2.7 (broken)
@astrojs/cloudflare   14.2.5
@sentry/astro         10.71.0
@astrojs/svelte       9.0.1
Node                  24.12.0
OS                    Linux (ubuntu-24.04, GitHub Actions runner)
output                "server"
```

### Describe the Bug

From `astro@7.2.6`, `astro dev` serves **HTTP 200 with a zero-byte body** for every
SSR page. Not a 500, not an error overlay — an empty string.

```
expect(received).toMatch(/^\s*<!doctype html>/i)
Received string:  ""
```

`<html>` comes back with no attributes and no content, so nothing hydrates and
no island mounts. The only requests that still behave are ones that never render
a page (middleware redirects, plain `Response` endpoints).

workerd logs an uncaught exception per request, naming the virtual module Astro
extracts from a layout's bare `<script>`:

```
[vite] Uncaught exception: workerd/jsg/_virtual_includes/iterator/workerd/jsg/value.h:1477:
  failed: remote.jsg.Error: Unable to resolve
  [/path/to/src/layouts/BaseLayout.astro?astro&type=script&index=0&lang.ts]
```

Because the exception is uncaught, the render is abandoned and the response is
flushed empty.

### Three integrations are load-bearing, together

`@astrojs/cloudflare` + `@sentry/astro` + `@astrojs/svelte`. Removing **either**
`@sentry/astro` or `@astrojs/svelte` makes the app render normally on every
version. Neither alone is enough — with only one of them present, a stripped
config renders fine on 7.2.7.

### The trigger is a cold Vite cache

```sh
rm -rf node_modules/.vite .astro
```

Cold reproduces every time. A warm cache masks it completely. This matters a lot
in practice: CI installs fresh on every run, so CI always hits it, while a
developer machine after one previous run never does. In our case a dependency
bump was verified locally, passed, merged — and then failed every CI run
afterwards, with the dev server timing out and no artifact to explain why.

### Bisect

Cold cache, holding `@astrojs/cloudflare` at 14.2.5:

| astro | result |
|---|---|
| 7.2.0 | renders |
| 7.2.2 | renders |
| 7.2.4 | renders |
| 7.2.5 | renders |
| **7.2.6** | **empty body** |
| 7.2.7 | empty body |

**The adapter is not the trigger** — `astro@7.2.0` + `@astrojs/cloudflare@14.2.5`
renders fine, so the change is on the Astro side between 7.2.5 and 7.2.6.
(`astro@7.2.7` + `@astrojs/cloudflare@14.1.3` is not a usable control: the dev
server does not boot, per the adapter's peer range.)

### What I could not reduce, and a possible clue

I have not managed to reproduce the **permanent** form in a fresh minimal
project. The reduction in this repo — the same three integrations, a layout with
a bare `<script>` that imports a module, one island, one middleware — reproduces
something closely related but weaker:

- **Every version, including 7.2.5**, returns an empty 200 for the *first*
  request that lands right after Vite logs
  `optimized dependencies changed. reloading` → `program reload`.
- On that reduction the next request, ~3s later, renders correctly.

In the real application on 7.2.6+ the same empty response never recovers: 10
attempts over 30s, and in CI 20 minutes of continuous requests, all zero bytes.

So the shape of it is: **a request arriving during a dependency-optimizer reload
gets an empty 200 instead of being queued or erroring** — and from 7.2.6 that
state appears to become permanent rather than transient. If that framing is
right, the transient case may be the easier one to fix and the useful place to
look, since it reproduces on a small project on any version.

### Steps to Reproduce

```sh
git clone <this repo> && cd astro-mre
npm install
npm run repro
```

`scripts/repro.mjs` clears `node_modules/.vite` and `.astro`, starts `astro dev`,
waits for readiness on `/health` (a route that renders no layout, so the probe
cannot warm the page under test), then requests `/page` up to 10 times over ~30s.
It fails only if the page **never** renders, so a single empty response followed
by a good one is reported rather than failed — the two cases above need to be
told apart.

Compare versions:

```sh
npm install --no-save astro@7.2.5 && npm run repro
npm install --no-save astro@7.2.7 && npm run repro
```

`.github/workflows/repro.yaml` runs this across 7.2.5 / 7.2.6 / 7.2.7 on a fresh
checkout with no dependency cache.

### What's the expected result?

The dev server renders the page, or fails loudly. A 200 with an empty body is
indistinguishable from a successful render to anything downstream — a browser, a
test runner, a health check — which is what made this expensive to track down.

### Link to Minimal Reproducible Example

<this repo>

### Participation

- [x] I am willing to submit a pull request for this issue.
