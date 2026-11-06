import assert from "node:assert/strict";
import {
    acceptIdleContentData,
    clearIdleState,
    getIdleState,
    setIdleState,
    subscribeIdleState,
    type IdleState,
} from "../game/plugins/idlehud/idleState";

const sample: IdleState = {
    idle: true,
    auto: true,
    paused: null,
    activity: "Chop down willow tree",
    xpPerHour: 48100,
    points: 1284,
    nextPercent: 53,
};

const seen: Array<IdleState | null> = [];
const unsubscribe = subscribeIdleState((state) => seen.push(state));

// The idle dataset is taken off the content channel and never reaches the content store.
assert.equal(
    acceptIdleContentData({ gamemodeId: "idle", datasets: [{ key: "state", rows: [sample] }] }),
    true,
);
assert.deepEqual(getIdleState(), sample);
assert.deepEqual(seen.at(-1), sample);

// Anything else on that channel is left alone for the store that owns it.
assert.equal(acceptIdleContentData({ gamemodeId: "leagues", datasets: [{ key: "state", rows: [sample] }] }), false);
assert.equal(acceptIdleContentData({ gamemodeId: "idle", datasets: [{ key: "somethingElse", rows: [] }] }), false);
assert.equal(acceptIdleContentData({}), false);
assert.deepEqual(getIdleState(), sample, "and none of those changed the state");

// A payload with no row means the server has nothing to show, which is a state of its own.
assert.equal(acceptIdleContentData({ gamemodeId: "idle", datasets: [{ key: "state", rows: [] }] }), true);
assert.equal(getIdleState(), null);

// Logging out drops it, and only tells listeners when there was something to drop.
setIdleState(sample);
const before = seen.length;
clearIdleState();
assert.equal(getIdleState(), null);
assert.equal(seen.length, before + 1);
clearIdleState();
assert.equal(seen.length, before + 1, "already clear: nobody is told twice");

// A listener that throws must not stop the others.
const quiet: Array<IdleState | null> = [];
const stopAngry = subscribeIdleState(() => {
    throw new Error("boom");
});
const stopQuiet = subscribeIdleState((state) => quiet.push(state));
setIdleState(sample);
assert.deepEqual(quiet.at(-1), sample);
stopAngry();
stopQuiet();

unsubscribe();
setIdleState(null);
assert.equal(seen.at(-1), sample, "unsubscribed listeners stop hearing");

console.log("Idle HUD state test passed");
