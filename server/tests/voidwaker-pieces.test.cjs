// Run after `yarn build`: node --test tests/voidwaker-pieces.test.cjs
// The Voidwaker pieces' Inspect lines (Wiki: Voidwaker hilt, Voidwaker blade, Voidwaker gem) and
// the line for using one piece on another (Wiki: Voidwaker), through the real hook dispatch with
// a real Player and cache. docs/wilderness-bosses.md#voidwaker-pieces.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const VoidwakerPieces = require('../plugins/bosses/wildernessbosses/VoidwakerPieces.WildernessBosses');

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  VoidwakerPieces.attach(PluginManager.createApi('VoidwakerPiecesTest'));
});

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);

// The Wiki's quoted lines, by gameval.
const INSPECT = {
  wbr_voidwaker_hilt: "A sturdy hilt. It's part of what looks to be a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
  wbr_voidwaker_blade: 'A sharp blade. It looks to be the deadliest part of a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?',
  wbr_voidwaker_gem: 'A magical gem. It looks like it could be fitted into a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?',
};
const COMBINE = "You don't think you have the skills to reassemble this weapon yourself.";

/** A player holding the three pieces in slots 0-2, whose chat lines land in `messages`. */
function holder(t) {
  const player = new Player(null);
  const messages = [];
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'sendMessage', (text) => { messages.push(text); });
  Object.keys(INSPECT).forEach((gameval, slot) => player.getInventory().setItem(slot, new Item(obj(gameval), 1)));
  return { player, messages };
}

const held = (player) => [0, 1, 2].map((slot) => player.getInventory().getItems()[slot]?.getId() ?? -1);

test('the cache names the hooks match are the three pieces, each with Inspect', () => {
  for (const gameval of Object.keys(INSPECT)) {
    const def = core.ItemDefinition.forId(obj(gameval));
    assert.ok(VoidwakerPieces._test.PIECES[def.getName()], `${gameval} (${def.getName()}) has no line`);
    assert.equal(core.CacheDefinitions.getItem(obj(gameval)).inventoryActions[0], 'Inspect', gameval);
  }
});

test("Inspect sends the piece's Wiki line to the chat and changes nothing", (t) => {
  Object.entries(INSPECT).forEach(([gameval, line], slot) => {
    const { player, messages } = holder(t);
    const item = player.getInventory().getItems()[slot];
    const handled = PluginManager.emitItemAction({ player, item, itemId: obj(gameval), slot, clickType: 1, handled: false });
    assert.equal(handled, true, gameval);
    assert.deepEqual(messages, [line], gameval);
    assert.deepEqual(held(player), Object.keys(INSPECT).map(obj), gameval);
  });
});

test('one piece on another, in either order, says the player cannot reassemble it and uses nothing up', (t) => {
  const ids = Object.keys(INSPECT).map(obj);
  for (let used = 0; used < 3; used++) {
    for (let target = 0; target < 3; target++) {
      if (used === target) continue;
      const { player, messages } = holder(t);
      const items = player.getInventory().getItems();
      const handled = PluginManager.emitItemOnItem({
        player, usedItem: items[used], usedItemId: ids[used], usedItemSlot: used,
        usedWithItem: items[target], usedWithItemId: ids[target], usedWithItemSlot: target, handled: false,
      });
      assert.equal(handled, true, `${used} on ${target}`);
      assert.deepEqual(messages, [COMBINE], `${used} on ${target}`);
      assert.deepEqual(held(player), ids, `${used} on ${target}`);
    }
  }
});

test('a piece on something else is left to other handlers', (t) => {
  const { player, messages } = holder(t);
  player.getInventory().setItem(5, new Item(obj('voidwaker'), 1));
  const items = player.getInventory().getItems();
  PluginManager.emitItemOnItem({
    player, usedItem: items[0], usedItemId: items[0].getId(), usedItemSlot: 0,
    usedWithItem: items[5], usedWithItemId: obj('voidwaker'), usedWithItemSlot: 5, handled: false,
  });
  assert.deepEqual(messages.filter((m) => m === COMBINE), []);
});
