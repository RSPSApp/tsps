import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const result = spawnSync("yarn", ["build"], {
    cwd: fileURLToPath(new URL("../../../client/", import.meta.url)),
    env: {
        ...process.env,
        PUBLIC_URL: "/",
        REACT_APP_SERVERS_JSON: "[]",
        REACT_APP_DEFAULT_WS_URL: "",
        REACT_APP_DEFAULT_SERVER_ADDRESS: "",
        REACT_APP_DEFAULT_SERVER_NAME: "",
        REACT_APP_DEFAULT_SERVER_SECURE: "",
    },
    stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
// Keep the release's cache selection, without putting game cache data in the bundle.
const output = new URL("../../../client/build/caches/", import.meta.url);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(new URL("../../../server/caches/caches.json", import.meta.url), new URL("caches.json", output));
