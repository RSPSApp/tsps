// Run after `yarn build`: node --test tests/run-invert-mode.test.cjs
// All Settings "Ctrl+click to invert run mode" (row 207, varbit 13132 runinvert_mode, enum 4074):
// a Ctrl-click walk inverts the run mode only in the directions the chosen option allows.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { runInvertAllowed } = require('../dist/net/NetworkBuilder');

const RUN_INVERT_MODE_VARBIT = 13132;

before(async () => {
  await CachePipeline.initialize();
});

function playerWithMode(mode) {
  return { getPacketSender: () => ({ getVarbit: (id) => (id === RUN_INVERT_MODE_VARBIT ? mode : 0) }) };
}

test('each option of the dropdown allows the inversions it names', () => {
  const options = [
    ['Never', 0, { walking: false, running: false }],
    ['Walk -> Run Only', 1, { walking: true, running: false }],
    ['Run -> Walk Only', 2, { walking: false, running: true }],
    ['Always', 3, { walking: true, running: true }],
  ];
  for (const [name, mode, allowed] of options) {
    assert.equal(runInvertAllowed(playerWithMode(mode), false), allowed.walking, `${name}: Ctrl-click while walking`);
    assert.equal(runInvertAllowed(playerWithMode(mode), true), allowed.running, `${name}: Ctrl-click while running`);
  }
});
