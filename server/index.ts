import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const port = Number(process.env.PORT ?? 8787);
const configPath = resolve(process.env.BOTS_CONFIG ?? "bots.local.yaml");

const app = await createApp({ loadConfig: () => loadConfig(configPath) });

// In production (Cloud Run) this server also serves the built UI; in development
// Vite serves it and proxies /api here.
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.get("*", serveStatic({ path: "./dist/web/index.html" }));
}

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`line-bot-playground controller: http://localhost:${info.port} (config: ${configPath})`);
});
