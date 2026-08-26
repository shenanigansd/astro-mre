import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import sentry from "@sentry/astro";
import { defineConfig } from "astro/config";

// All three integrations are load-bearing. Drop @sentry/astro OR @astrojs/svelte
// and the dev server renders normally, on every astro version.
export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [sentry({ org: "example", project: "example" }), svelte()],
});
