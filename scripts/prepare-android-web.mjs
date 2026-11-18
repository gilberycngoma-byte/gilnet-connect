import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createLocalAppServer } = require("../electron/local-server.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDirectory = path.join(root, "dist", "client");
const configPath = path.join(clientDirectory, "desktop-supabase-config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

if (
  !config ||
  typeof config.url !== "string" ||
  !/^https?:\/\//.test(config.url) ||
  typeof config.publishableKey !== "string" ||
  !config.publishableKey
) {
  throw new Error("The Android web bundle is missing its Supabase URL or publishable key.");
}

process.env["SUPABASE_URL"] = config.url;
process.env["SUPABASE_PUBLISHABLE_KEY"] = config.publishableKey;

const app = await createLocalAppServer({
  clientDirectory,
  serverEntry: path.join(root, "dist", "server", "server.js"),
  host: "127.0.0.1",
  port: 0,
  onRequestError: (error) => console.error("Could not render the Android app shell.", error),
});

try {
  const response = await fetch(new URL("/", app.origin));
  const html = await response.text();
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html") ||
    !html.includes("$_TSR") ||
    !/<script[^>]+src="\/assets\/index-[^"]+\.js"/.test(html)
  ) {
    throw new Error(
      `The Android app shell could not be generated from the server bundle (HTTP ${response.status}).`,
    );
  }
  await writeFile(path.join(clientDirectory, "index.html"), html, "utf8");
  console.log("Prepared the Android app shell from the current client and server bundles.");
} finally {
  await app.close();
}
