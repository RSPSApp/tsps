import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const client = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const probe = `
    const childProcess = require('node:child_process');
    const original = childProcess.execFileSync;
    // Isolate the unrelated cache export; exercise the actual CRACO/CRA path configuration.
    childProcess.execFileSync = (file, args, options) => args?.includes('scripts/browser-host-interface-definitions.ts')
        ? '[]' : original(file, args, options);
    const config = require(${JSON.stringify(join(client, "craco.config.js"))});
    const paths = require('react-scripts/config/paths');
    const configured = config.paths({});
    process.stdout.write(JSON.stringify({ configured: configured.appBuild, shared: paths.appBuild }));
`;

for (const [name, value, expected] of [
    ["unset", undefined, join(client, "build")],
    ["empty", "", join(client, "build")],
    ["relative", "../.runtime/client-stage", resolve(client, "../.runtime/client-stage")],
    ["absolute", join(tmpdir(), "tsps-staged-client"), join(tmpdir(), "tsps-staged-client")],
] as const) {
    test(`production CRACO paths honor ${name} BUILD_PATH`, () => {
        const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
        delete env.BUILD_PATH;
        if (value !== undefined) env.BUILD_PATH = value;
        const actual = JSON.parse(execFileSync(process.execPath, ["-e", probe], {
            cwd: client, env, encoding: "utf8",
        }));
        assert.deepEqual(actual, { configured: expected, shared: expected });
    });
}
