import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

// This hosted TanStack app requires its server; do not package an SSR build as file:// HTML.
const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const electronDependency = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron;
const electronVersion = typeof electronDependency === "string" ? electronDependency.replace(/^[^\d]*/, "") : "";
if (!electronVersion) throw new Error("Could not determine the Electron version from package.json.");
const staging = await mkdtemp(path.join(tmpdir(), "gilnet-windows-source-"));
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(fileURLToPath(root), "release", `electron-windows-${packageJson.version}`);
try {
  await mkdir(path.join(staging, "electron"));
  await mkdir(path.join(staging, "public"));
  for (const file of [
    "electron/main.cjs",
    "electron/preload.cjs",
    "electron/google-drive.cjs",
    "public/splash.html",
    "public/gilnet-logo.png",
    "public/gilnet.ico",
    "public/icon-512.png",
  ]) {
    await copyFile(new URL(file, root), path.join(staging, file));
  }
  await writeFile(
    path.join(staging, "package.json"),
    JSON.stringify(
      {
        name: packageJson.name,
        productName: packageJson.productName,
        version: packageJson.version,
        description: packageJson.description,
        main: "electron/main.cjs",
      },
      null,
      2,
    ),
  );
  const paths = await packager({
    dir: staging,
    name: "GILNET-(GPM)-APP",
    platform: "win32",
    arch: "x64",
    electronVersion,
    out: output,
    overwrite: true,
    asar: true,
    prune: false,
    icon: path.join(staging, "public", "gilnet.ico"),
    win32metadata: { ProductName: packageJson.productName },
    appCopyright: "2026 GILNET (GPM) APP",
  });
  console.log("Windows portable package:", paths.join(", "));
  console.log(
    "Not an installer or offline desktop release; Windows launch verification is required.",
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
