// Run after `yarn build`: node --test tests/event-loop-probe.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { GameEngine } = require('../dist/game/GameEngine');

test('one event loop stall is reported once, not on every later probe', () => {
    const logged = [];
    let now = 0;
    const engine = Object.create(GameEngine.prototype);
    Object.assign(engine, {
        nextEventLoopProbeAt: 1000, eventLoopProbeIntervalMs: 1000, eventLoopStallThresholdMs: 1500, tickNumber: 0,
        logFreezeDiagnostic: (event, _at, details) => logged.push(details.stallMs),
    });
    const probe = (at) => { now = at; engine.probeEventLoopDelay(); };
    const real = performance.now;
    try {
        performance.now = () => now;
        probe(1000);
        probe(3700); // the loop was blocked for 1.7s
        for (let at = 4700; at <= 20700; at += 1000) probe(at); // then probes run on time again
    } finally {
        performance.now = real;
    }
    assert.deepEqual(logged, [1700]);
});
