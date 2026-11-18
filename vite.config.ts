import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Plugin as PostCSSPlugin } from "postcss";

const androidCompatibilityBuild = process.env["GILNET_ANDROID_COMPAT"] === "1";

const flattenCascadeLayers: PostCSSPlugin = {
  postcssPlugin: "gilnet-android-cascade-layer-compat",
  Once(root) {
    root.walkAtRules("layer", (rule) => {
      if (rule.nodes?.length) rule.replaceWith(...rule.nodes);
      else rule.remove();
    });
  },
};

function offlinePrecachePlugin(supabaseConfig: { url?: string; publishableKey?: string }): Plugin {
  return {
    name: "gilnet-offline-precache",
    apply: "build",
    async writeBundle(options, bundle) {
      if (
        !options.dir ||
        path.resolve(options.dir).toLowerCase() !== path.resolve("dist/client").toLowerCase()
      ) {
        return;
      }
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/") && !file.endsWith(".map"))
        .map((file) => `/${file}`);
      await writeFile(
        path.join(options.dir, "precache-manifest.json"),
        JSON.stringify(assets),
        "utf8",
      );
      if (!supabaseConfig.url || !supabaseConfig.publishableKey) {
        throw new Error(
          "VITE_SUPABASE_URL and a Supabase publishable key are required for the packaged Electron app.",
        );
      }
      if (isServiceRoleKey(supabaseConfig.publishableKey)) {
        throw new Error(
          "A service-role key cannot be used as the bundled Supabase publishable key.",
        );
      }
      await writeFile(
        path.join(options.dir, "desktop-supabase-config.json"),
        JSON.stringify(supabaseConfig),
        "utf8",
      );
    },
  };
}

function isServiceRoleKey(value: string) {
  if (value.startsWith("sb_secret_")) return true;
  const payload = value.split(".")[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const serverEnv = loadEnv(mode, process.cwd(), "SUPABASE_");
  const supabaseUrl = serverEnv["SUPABASE_URL"] || env["VITE_SUPABASE_URL"];
  const publishableKey =
    serverEnv["SUPABASE_PUBLISHABLE_KEY"] ||
    env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    env["VITE_SUPABASE_ANON_KEY"];

  if (supabaseUrl) process.env["SUPABASE_URL"] = supabaseUrl;
  if (publishableKey) process.env["SUPABASE_PUBLISHABLE_KEY"] = publishableKey;
  if (serverEnv["SUPABASE_SERVICE_ROLE_KEY"]) {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = serverEnv["SUPABASE_SERVICE_ROLE_KEY"];
  }

  return {
    ...(publishableKey
      ? {
          define: {
            "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publishableKey),
          },
        }
      : {}),
    plugins: [
      tanstackStart(),
      tailwindcss(),
      react(),
      offlinePrecachePlugin({
        ...(supabaseUrl ? { url: supabaseUrl } : {}),
        ...(publishableKey ? { publishableKey } : {}),
      }),
    ],
    ...(androidCompatibilityBuild
      ? {
          build: { target: "chrome80" },
          css: { postcss: { plugins: [flattenCascadeLayers] } },
        }
      : {}),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      watch: {
        ignored: ["**/release/**"],
      },
    },
    test: {
      environment: "jsdom",
    },
  };
});
