import type { APIRoute } from "astro";

// A route that renders no layout, so the readiness probe cannot warm the page
// under test.
export const GET: APIRoute = () => new Response("ok");
