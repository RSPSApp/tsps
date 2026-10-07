// Run after `yarn build`: node --test tests/click-teleport.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { PluginManager } = require('../dist/plugins/PluginManager');
const ClickTeleport = require('../plugins/commands/ClickTeleport.plugin');

/** MOVE_GAMECLICK (16) as the client writes it: y, key byte, x, target loc id. */
function gameClick(x, y, key) {
    const shortAddLE = (value) => [(value >> 8) & 0xff, ((value & 0xff) + 128) & 0xff];
    return Buffer.from([16, ...shortAddLE(y), -key & 0xff, ...shortAddLE(x), 128, 0]);
}

test('a game click carries its key byte: 0 plain, 1 Ctrl, 2 Ctrl+Shift', () => {
    for (const key of [0, 1, 2]) {
        const [move] = decodeClientPackets(gameClick(3222, 3218, key));
        assert.deepEqual(move, { type: 'move', worldX: 3222, worldY: 3218, modifierFlags: key });
    }
});

test("the WALK packet's run bit forces running instead of posing as a Ctrl+Shift click", () => {
    const walk = (flags) => Buffer.from([210, 0x0c, 0x96, 0x0c, 0x92, flags]);
    assert.deepEqual(decodeClientPackets(walk(1))[0], { type: 'move', worldX: 3222, worldY: 3218, modifierFlags: 0, run: true });
    assert.deepEqual(decodeClientPackets(walk(2))[0], { type: 'move', worldX: 3222, worldY: 3218, modifierFlags: 1, run: false });
});

function clickBy(allowed, key, t) {
    const hasRights = PluginManager.playerHasCommandRights;
    PluginManager.playerHasCommandRights = (_player, command) => command === 'tele' && allowed;
    t.after(() => { PluginManager.playerHasCommandRights = hasRights; });
    const moves = [];
    const player = {
        getLocation: () => ({ getZ: () => 1 }),
        moveTo: (location) => moves.push([location.getX(), location.getY(), location.getZ()]),
    };
    const input = { player, packet: { type: 'move', worldX: 3222, worldY: 3218, modifierFlags: key }, handled: false };
    ClickTeleport._test.clickTeleport(input);
    return { moves, handled: input.handled };
}

test('a Ctrl+Shift click teleports a player who may ::tele, on their own plane', (t) => {
    assert.deepEqual(clickBy(true, 2, t), { moves: [[3222, 3218, 1]], handled: true });
});

test('anyone else, or a plain or Ctrl click, just walks', (t) => {
    assert.deepEqual(clickBy(false, 2, t), { moves: [], handled: false });
    assert.deepEqual(clickBy(true, 1, t), { moves: [], handled: false });
    assert.deepEqual(clickBy(true, 0, t), { moves: [], handled: false });
});
