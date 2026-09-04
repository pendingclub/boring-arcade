import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

if (
  packageJson.name !== "boring-arcade" ||
  packageJson.private === true ||
  packageJson.bin?.["boring-arcade"] !== "dist/cli.js" ||
  JSON.stringify(packageJson.files) !== JSON.stringify(["dist/cli.js"]) ||
  typeof packageJson.repository?.url !== "string" ||
  !packageJson.repository.url.startsWith("git+https://github.com/") ||
  packageJson.repository.url.includes("website-boring")
) {
  throw new Error("Unexpected public package metadata");
}

const forbidden = /(?:^|\/)(?:output|docs|tests|plugins|\.git)(?:\/|$)|(?:^|\/)(?:\.env(?:\.|$)|.*\.(?:pem|key|ppk))$/i;
const npmCli =
  process.env.npm_execpath ??
  resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const { stdout } = await execFileAsync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--ignore-scripts", "--json"],
  { cwd: root, timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 }
);
let metadata;
for (let offset = stdout.indexOf("["); offset >= 0; offset = stdout.indexOf("[", offset + 1)) {
  try {
    const candidate = JSON.parse(stdout.slice(offset));
    if (Array.isArray(candidate)) {
      metadata = candidate;
      break;
    }
  } catch {
    // npm may print lifecycle output before the JSON document.
  }
}
if (!metadata) throw new Error("npm pack did not return JSON metadata");
const files = metadata[0]?.files?.map(({ path }) => path).filter(Boolean) ?? [];
const expected = ["LICENSE", "README.md", "dist/cli.js", "package.json"];
if (JSON.stringify(files.slice().sort()) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected npm package files: ${files.join(", ")}`);
}
if (files.some((path) => forbidden.test(path))) {
  throw new Error("Forbidden path would be included in the npm package");
}

const executable = await stat(resolve(root, "dist/cli.js"));
if (process.platform !== "win32" && (executable.mode & 0o111) === 0) {
  throw new Error("dist/cli.js is not executable; run npm run build or prepack first");
}

const { stdout: listOutput } = await execFileAsync(
  process.execPath,
  [resolve(root, "dist/cli.js"), "--list", "--json"],
  { cwd: root, timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 }
);
const list = JSON.parse(listOutput);
if (list.version !== packageJson.version || !Array.isArray(list.games) || list.games.length !== 3) {
  throw new Error("Bundled CLI smoke check failed");
}

process.stdout.write(`Public package verified: ${files.length} files, ${list.games.length} games.\n`);
