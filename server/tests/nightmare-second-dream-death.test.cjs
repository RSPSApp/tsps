// Run after `yarn build`: node --test tests/nightmare-second-dream-death.test.cjs
// A second death in The Nightmare's dream before collecting loses the first death's items (Wiki, The Nightmare:
// "Any unsafe death will delete all items left inside the deathbank"); the keeper then holds only the new death's.
// Real engine: every plugin loaded, a real Player with a real Inventory, and the real death item loss
// (PlayerDeathTask.dropItems); only the dream lookup is pinned and the network stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
const Common = require("../plugins/bosses/nightmare/Common.Nightmare");
const Dream = require("../plugins/bosses/nightmare/Dream.Nightmare");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function dreamer(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(13900);
  p.setUsername("seconddream");
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3870, 9949, 3));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.mock.method(Dream, "dreamOf", (who) => (who === p ? { phosani: false, players: new Set([p]) } : null));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

const die = (p) => PlayerDeathTask.dropItems(p, null, p.getLocation().clone());
const heldIds = (p) => (p.getAttribute(Common.HELD_ITEMS_ATTRIBUTE)?.items ?? []).map(([id, amount]) => [id, amount]);

test("a second dream death loses the first death's items; Shura holds only the second death's", (t) => {
  const f = dreamer(t);
  const { ItemIdentifiers: I, Item } = core;
  for (let i = 0; i < 5; i++) f.inv.add(new Item(I.ABYSSAL_WHIP, 1));
  die(f.p);
  const first = heldIds(f.p);
  assert.ok(first.some(([id]) => id === I.ABYSSAL_WHIP), `the first death's whips are held (${JSON.stringify(first)})`);
  assert.deepEqual(f.messages, []);

  f.inv.add(new Item(I.DRAGON_DAGGER, 1));
  f.inv.add(new Item(I.RUNE_SCIMITAR, 1));
  f.inv.add(new Item(I.ADAMANT_SCIMITAR, 1));
  f.inv.add(new Item(I.MITHRIL_SCIMITAR, 1));
  die(f.p);
  const second = heldIds(f.p);
  assert.equal(second.some(([id]) => id === I.ABYSSAL_WHIP), false, `no whip from the first death is held (${JSON.stringify(second)})`);
  assert.ok(second.length > 0 && second.every(([id]) => [I.DRAGON_DAGGER, I.RUNE_SCIMITAR, I.ADAMANT_SCIMITAR, I.MITHRIL_SCIMITAR].includes(id)),
    "only the second death's items");
  assert.equal(f.p.getAttribute(Common.HELD_ITEMS_ATTRIBUTE).paid, false);
  assert.deepEqual(f.messages, ["Your items left with Shura have been lost."]);
});
