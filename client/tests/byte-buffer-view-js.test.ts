import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("plain Node runs the JavaScript ByteBuffer regression", () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const result = spawnSync(process.execPath, [join(__dirname, "byte-buffer-view-js.test.cjs")], {
        env,
        encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
});
