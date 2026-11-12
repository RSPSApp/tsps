// Run after `yarn build`: node --test tests/inventory-preview-refresh.test.cjs
//
// An Inventory built on a player to plan a change (does the loot fit once the key is gone?) is never shown to
// that player: only the player's own inventory refreshes the inventory interface. Issue 4684: the Muddy chest's
// room check deleted the key from such a copy with a refresh, so the client showed the key gone although the
// refusal kept it.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");

before(async () => { await CachePipeline.initialize(process.cwd()); });

function actor(t) {
  const player = new Player(null);
  player.setUsername("previewqa");
  const shown = [];
  t.mock.method(player.getPacketSender(), "sendItemContainer", (container, interfaceId) => {
    shown.push({ interfaceId, ids: container.getItems().map((item) => item.getId()) });
  });
  return { player, shown };
}

test("a planning copy of the inventory refreshes nothing on the client", (t) => {
  const { player, shown } = actor(t);
  player.getInventory().setItem(0, new Item(995, 10));
  const plan = new Inventory(player).setItems(player.getInventory().getCopiedItems());
  plan.deleteNumber(995, 10);
  plan.add(new Item(1617, 1), true);
  plan.refreshItems();
  assert.deepEqual(shown, [], "no inventory packet for the copy");
  assert.equal(player.getInventory().getAmount(995), 10, "and the real inventory is untouched");
});

test("the player's own inventory still refreshes", (t) => {
  const { player, shown } = actor(t);
  player.getInventory().add(new Item(995, 10), true);
  player.getInventory().deleteNumber(995, 4);
  assert.equal(shown.length, 2);
  assert.ok(shown.every((entry) => entry.interfaceId === Inventory.INTERFACE_ID));
  assert.equal(shown[1].ids[0], 995);
});
