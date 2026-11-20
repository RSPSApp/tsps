import assert from "node:assert/strict";
import test from "node:test";
import { nextClientVersion } from "./release-version.mjs";

test("automatic releases increment the highest stable client version numerically", () => {
    assert.equal(nextClientVersion([]), "0.1.1");
    assert.equal(nextClientVersion(["server-v9.0.0", "client-v1.2.9", "client-v1.2.10", "client-v2.0.0-beta.1"]), "1.2.11");
    assert.equal(nextClientVersion(["client-v1.9.99", "client-v2.0.0"]), "2.0.1");
});

test("manual major and minor releases must be stable and newer", () => {
    assert.equal(nextClientVersion(["client-v1.2.3"], "1.3.0"), "1.3.0");
    assert.equal(nextClientVersion(["client-v1.2.3"], "2.0.0"), "2.0.0");
    for (const version of ["1.2.3", "1.2.2", "01.3.0", "2.0.0-beta.1", "bad\nversion"]) {
        assert.throws(() => nextClientVersion(["client-v1.2.3"], version));
    }
});
