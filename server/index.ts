import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const port = Number(process.env.PORT ?? 8787);
const configPath = resolve(process.env.BOTS_CONFIG ?? "bots.local.yaml");

const app = await createApp({ loadConfig: () => loadConfig(configPath) });

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`line-bot-playground controller: http://localhost:${info.port} (config: ${configPath})`);
});
