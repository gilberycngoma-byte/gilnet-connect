import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = path.join(root, "android");
const variant = process.argv[2] ?? "release";
if (variant !== "release" && variant !== "debug") {
  throw new Error("Choose the Android build variant 'release' or 'debug'.");
}

if (variant === "release") {
  const required = [
    "ANDROID_KEYSTORE_PATH",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Release APK signing is not configured. Set these local environment variables before building: ${missing.join(", ")}.`,
    );
  }
  if (!existsSync(path.resolve(process.env.ANDROID_KEYSTORE_PATH))) {
    throw new Error("The configured Android keystore file was not found.");
  }
}

process.env["GILNET_ANDROID_COMPAT"] = "1";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`Android build command failed: ${command}`);
  }
}

if (process.platform === "win32") {
  const shell = process.env.ComSpec ?? "cmd.exe";
  run(shell, ["/d", "/s", "/c", "call npm.cmd run android:sync"], root);
  run(
    shell,
    ["/d", "/s", "/c", `call gradlew.bat assemble${variant === "debug" ? "Debug" : "Release"}`],
    android,
  );
} else {
  run("npm", ["run", "android:sync"], root);
  run("./gradlew", [`assemble${variant === "debug" ? "Debug" : "Release"}`], android);
}

const apkFileName =
  variant === "release" && process.env.GILNET_ANDROID_VERSION
    ? `app-release-${process.env.GILNET_ANDROID_VERSION}.apk`
    : `app-${variant}.apk`;
const apkPath = path.join(android, "app", "build", "outputs", "apk", variant, apkFileName);
if (!existsSync(apkPath)) throw new Error(`Build succeeded but the APK was not found at ${apkPath}`);
console.log(`APK created: ${apkPath}`);
