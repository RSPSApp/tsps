import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync("yarn", ["build"], {
    cwd: fileURLToPath(new URL("../client/", import.meta.url)),
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
process.exit(result.status ?? 1);
