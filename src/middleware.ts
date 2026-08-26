import { defineMiddleware, sequence } from "astro:middleware";

// idinet composes its own middleware with the one @sentry/astro injects.
const tag = defineMiddleware(async (context, next) => {
  const response = await next();
  response.headers.set("x-mre", "1");
  return response;
});

export const onRequest = sequence(tag);
