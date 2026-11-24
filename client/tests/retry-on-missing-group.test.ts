import assert from "node:assert/strict";
import { test } from "node:test";

import { GroupMissingError } from "../rs/cache/js5/GroupMissingError";
import { retryOnMissingGroup } from "../rs/cache/js5/retryOnMissingGroup";

/** A read that misses `misses` times on group 7:42, then returns. */
function reader(misses: number) {
    let calls = 0;
    return {
        read: () => {
            calls++;
            if (calls <= misses) throw new GroupMissingError(7, 42, 0, 0);
            return "data";
        },
        get calls() {
            return calls;
        },
    };
}

test("a cold read retries as soon as its group's fetch lands, not after a poll", async () => {
    const r = reader(1);
    const waited: string[] = [];
    const t0 = performance.now();
    const result = await retryOnMissingGroup(r.read, 40, 250, async (index, archive) => {
        waited.push(`${index}:${archive}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    });
    assert.equal(result, "data");
    assert.deepEqual(waited, ["7:42"], "it waits on the group that missed");
    assert.ok(performance.now() - t0 < 150, "well under the 250ms poll");
});

test("without a waiter it keeps polling at the delay", async () => {
    const r = reader(1);
    const t0 = performance.now();
    assert.equal(await retryOnMissingGroup(r.read, 40, 60), "data");
    assert.ok(performance.now() - t0 >= 55);
});

test("a fetch that resolves without the data falls back to polling instead of spinning", async () => {
    const r = reader(3);
    let waits = 0;
    const t0 = performance.now();
    const result = await retryOnMissingGroup(r.read, 40, 30, async () => {
        waits++;
    });
    assert.equal(result, "data");
    assert.equal(waits, 1, "one wait for the group, then polls");
    assert.equal(r.calls, 4);
    assert.ok(performance.now() - t0 >= 55, "the two later misses each waited the delay");
});

test("a failed fetch waits the delay, and the whole wait stays within attempts * delay", async () => {
    const r = reader(1000);
    const t0 = performance.now();
    const result = await retryOnMissingGroup(r.read, 4, 25, () => Promise.reject(new Error("offline")));
    assert.equal(result, undefined);
    assert.ok(performance.now() - t0 < 250, "bounded by the attempt budget");
});
