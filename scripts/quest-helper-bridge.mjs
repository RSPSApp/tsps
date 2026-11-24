#!/usr/bin/env node
// Starts the local Quest Helper bridge (tools/quest-helper-bridge) with the token from the root
// .env, so the server and the bridge agree on the secret without either one reading the other's
// process environment.
//
// One bridge serves every worktree: sessions are per-request UUIDs, so nothing is shared between
// them and no port slot is needed. Run it beside `yarn start`, not inside it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const install = join(root, "tools", "quest-helper-bridge", "build", "install", "offline-quest-helper-bridge");
// The same JDK 21 lookup the server uses when it starts the bridge itself.
const { findJavaHome, javaExecutable } = createRequire(import.meta.url)("../server/plugins/quests/questhelper/Java.QuestHelper.js");

const token = process.env.QUEST_HELPER_TOKEN;
if (!token || token.length < 24) {
  console.error("QUEST_HELPER_TOKEN is missing or shorter than 24 characters (see .env.example).\n" +
    "Without a token you don't need this: `yarn start` starts the built bridge itself.");
  process.exit(1);
}

if (!existsSync(install)) {
  console.error(`The bridge is not built. See tools/quest-helper-bridge/README.md:\n  cd tools/quest-helper-bridge && ./gradlew installDist\nor run \`yarn bridge:setup\`.`);
  process.exit(1);
}
const lib = join(install, "lib");
if (!existsSync(lib) || !statSync(lib).isDirectory()) {
  console.error(`The bridge install is missing ${lib}; run ./gradlew installDist.`);
  process.exit(1);
}
const javaHome = findJavaHome();
if (!javaHome) {
  console.error("No JDK 21 found. Set JAVA_HOME or QUEST_HELPER_JAVA_HOME to one.");
  process.exit(1);
}

const args = ["-Djava.awt.headless=true", "-cp", join(lib, "*"), "local.questbridge.BridgeServer"];
console.log(`quest-helper-bridge: ${javaHome} ${args.slice(2).join(" ")}`);
const child = spawn(join(javaHome, "bin", javaExecutable()), args, {
  stdio: "inherit",
  env: { ...process.env, JAVA_HOME: javaHome },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 0 : code ?? 0));
