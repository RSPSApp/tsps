import assert from "node:assert/strict";
import { test } from "node:test";

import { serverInterfaces, sweepInterfaces } from "../scripts/cache/interface-sweep";

/**
 * Every interface our server opens loads offline as in game (onLoad, then each transmit
 * listener and timer once) without a script error. Rev 241's bank stopped at its tag scripts
 * (array varcs) and drew tags with item 0 (unset varc ints read 0): this is where such breaks
 * show. Item-0 and "null" output are not asserted: without the server's varps (the GE's offer
 * slots are -1 when empty) some interfaces show item 0 here only. Run the script for the report.
 */
test("every interface the server opens loads without script errors", () => {
    const used = serverInterfaces();
    const { cache, results } = sweepInterfaces();
    assert.ok(results.length > 500, `${results.length} interfaces in ${cache}`);
    const broken = results
        .filter((r) => used.has(r.group) && r.errors.size > 0)
        .map((r) => `${r.name} (${r.group}): ${[...r.errors.keys()].join("; ")}`);
    assert.deepEqual(broken, []);
});
