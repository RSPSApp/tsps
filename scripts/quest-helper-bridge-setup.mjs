#!/usr/bin/env node
// One-time build of the Quest Helper bridge (tools/quest-helper-bridge). Clones upstream Quest
// Helper at the commit build.gradle pins, then runs `gradlew installDist` with a JDK 21. After
// this, `yarn start` starts the bridge itself; no token or second terminal is needed.
//
// QUEST_HELPER_SOURCE points at an existing checkout instead of cloning one.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

const { findJavaHome } = createRequire(import.meta.url)("../server/plugins/quests/questhelper/Java.QuestHelper.js");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridge = join(root, "tools", "quest-helper-bridge");
const UPSTREAM = "https://github.com/Zoinkwiz/quest-helper";

function fail(message) {
  console.error(`bridge:setup: ${message}`);
  process.exit(1);
}
function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) fail(`${command} could not start (${result.error.message})`);
  if (result.status !== 0) fail(`${command} ${args[0]} exited with ${result.status}`);
}
function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

const pinned = readFileSync(join(bridge, "build.gradle"), "utf8").match(/!= '([0-9a-f]{40})'/)?.[1];
if (!pinned) fail("could not read the pinned Quest Helper commit from tools/quest-helper-bridge/build.gradle");

const javaHome = findJavaHome();
if (!javaHome) fail("no JDK 21 found. Install one (for example Eclipse Temurin 21) or set QUEST_HELPER_JAVA_HOME.");
if (git(["--version"]).status !== 0) fail("git is not on PATH.");

const source = process.env.QUEST_HELPER_SOURCE ? resolve(process.env.QUEST_HELPER_SOURCE) : join(bridge, "quest-helper-upstream");
if (!existsSync(join(source, ".git"))) {
  if (process.env.QUEST_HELPER_SOURCE) fail(`QUEST_HELPER_SOURCE (${source}) is not a git checkout.`);
  run("git", ["clone", "--filter=blob:none", "--no-checkout", UPSTREAM, source]);
}
// Upstream has paths past Windows' 260-character limit; without this git skips those files.
if (platform() === "win32") run("git", ["config", "core.longpaths", "true"], { cwd: source });
if (git(["cat-file", "-e", `${pinned}^{commit}`], source).status !== 0) run("git", ["fetch", "origin", pinned], { cwd: source });
const head = git(["rev-parse", "HEAD"], source).stdout?.trim();
// git refuses to overwrite local edits, and the Gradle build checks the checkout is unmodified.
if (head !== pinned) run("git", ["checkout", "--detach", pinned], { cwd: source });
const changes = () => (git(["status", "--porcelain"], source).stdout ?? "").split("\n").filter(Boolean);
// Files missing from a fresh or interrupted checkout come back (" D" missing from disk, "D " never
// checked out); anything edited is left for the user.
if (changes().length && changes().every((line) => /^( D|D )/.test(line))) run("git", ["checkout", "HEAD", "--", "."], { cwd: source });
if (changes().length) fail(`${source} differs from ${pinned}:\n${changes().slice(0, 10).join("\n")}\nRestore it (git checkout -- .) and run this again.`);

const buildEnv = { ...process.env, JAVA_HOME: javaHome, ...(process.env.QUEST_HELPER_SOURCE ? { QUEST_HELPER_SOURCE: source } : {}) };
if (platform() === "win32") {
  // A .bat needs cmd. Its path is absolute and quoted: cmd may not search the working directory.
  run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${join(bridge, "gradlew.bat")}" installDist --no-daemon"`],
    { cwd: bridge, env: buildEnv, windowsVerbatimArguments: true });
} else {
  run(join(bridge, "gradlew"), ["installDist", "--no-daemon"], { cwd: bridge, env: buildEnv });
}
console.log("\nQuest Helper bridge built. Restart the server: it starts the bridge itself.");
