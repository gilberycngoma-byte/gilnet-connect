import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [bump, ...noteParts] = process.argv.slice(2);
const releaseNotes = noteParts.join(" ").trim();

if (!["major", "minor", "patch"].includes(bump) || !releaseNotes) {
  throw new Error('Usage: npm run release:prepare -- <major|minor|patch> "Release notes"');
}

const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const versionPath = path.join(root, "src", "lib", "version.ts");
const manifestPath = path.join(root, "public", "version.json");
const installerBaseUrl = "https://qyawsbiipskhpstnemno.supabase.co/storage/v1/object/public/installers";
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentVersion = packageJson.version;
const packageLock = JSON.parse(await readFile(lockPath, "utf8"));
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version);
if (!versionMatch) throw new Error(`Invalid package version: ${packageJson.version}`);

const [, majorText, minorText, patchText] = versionMatch;
let major = Number(majorText);
let minor = Number(minorText);
let patch = Number(patchText);
if (bump === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}
const version = `${major}.${minor}.${patch}`;

const versionSource = await readFile(versionPath, "utf8");
if (!versionSource.includes(`APP_VERSION = "${currentVersion}"`)) {
  throw new Error("package.json and src/lib/version.ts versions do not match.");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.latestStable !== packageJson.version) {
  throw new Error("package.json and public/version.json versions do not match.");
}

packageJson.version = version;
packageLock.version = version;
packageLock.packages[""].version = version;
manifest.latestStable = version;
manifest.releaseNotes = releaseNotes;
manifest.forced = false;
manifest.publicUrl = `${installerBaseUrl}/GILNET-GPM-CONNECT-${version}-Setup.exe`;
manifest.apkUrl = `${installerBaseUrl}/GILNET-GPM-CONNECT.apk`;

const nextVersionSource = versionSource
  .replace(`APP_VERSION = "${currentVersion}"`, `APP_VERSION = "${version}"`)
  .replace(/BUILD_DATE = "\d{4}-\d{2}-\d{2}"/, `BUILD_DATE = "${new Date().toISOString().slice(0, 10)}"`);
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
await writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`, "utf8");
await writeFile(versionPath, nextVersionSource, "utf8");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  `Prepared release ${version}. Upload the Windows installer, .blockmap, latest.yml, and signed APK to the Supabase installers bucket, then publish the app_versions row.`,
);
