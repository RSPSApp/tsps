// Run after `yarn build`: node --test tests/game-engine-clock.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { GameEngine } = require('../dist/game/GameEngine');
const { World } = require('../dist/game/World');

test("a wall clock that jumps (WSL2 resyncs it) doesn't look like tick lag: the engine times ticks monotonically", async (t) => {
    const process = World.process;
    const savePlayers = World.savePlayers;
    const dateNow = Date.now;
    const warn = console.warn;
    const warnings = [];
    let wall = dateNow();
    World.process = () => {};
    World.savePlayers = () => {};
    Date.now = () => (wall += 3000); // every read jumps 3 s ahead
    console.warn = (message) => warnings.push(String(message));
    t.after(() => {
        World.process = process;
        World.savePlayers = savePlayers;
        Date.now = dateNow;
        console.warn = warn;
    });
    const engine = new GameEngine();
    engine.scheduleNextRun = () => {}; // drive the ticks by hand
    for (let i = 0; i < 4; i++) await engine.run();
    assert.deepEqual(warnings.filter((message) => message.includes('tick_start_lag')), []);
});

test("the first tick, which waits for startup, sets the schedule without a lag warning; drift is whole milliseconds", async (t) => {
    const process = World.process;
    const warn = console.warn;
    const warnings = [];
    World.process = () => {};
    console.warn = (message) => warnings.push(String(message));
    t.after(() => {
        World.process = process;
        console.warn = warn;
    });
    const engine = new GameEngine();
    engine.scheduleNextRun = () => {};
    engine.nextExpectedTickAt = 0.5; // startup ran well past the first tick's slot
    await engine.run();
    assert.deepEqual(warnings, [], 'tick 1: no warning');
    engine.lastLagLogAt = -Infinity; // the 5 s warning cooldown counts from process start
    // A real stall before tick 2: its slot passed long ago (the monotonic clock starts at the
    // process's start, so wait until there is room for that in this young test process).
    await new Promise((resolve) => setTimeout(resolve, 600));
    engine.nextExpectedTickAt = 1.5;
    await engine.run();
    const lag = warnings.find((message) => message.includes('tick_start_lag'));
    assert.match(lag ?? '', /driftMs=\d+ /, 'logged, in whole milliseconds');
});
