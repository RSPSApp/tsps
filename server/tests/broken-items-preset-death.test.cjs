// Run after `yarn build`: node --test tests/broken-items-preset-death.test.cjs
// A PvP death breaks an unprotected breakable untradeable and pays the killer its repair cost (Wiki: Items Kept
// on Death). A preset copy (untradeable, unbankable, preset, as Presets.PvpMode tags it) was never paid for, so
// it pays nothing: otherwise every free preset fire cape, torso or defender mints coins for the killer. Real
// engine: every plugin loaded, a real victim and killer in the Wilderness, and the real PlayerDeathTask.dropItems.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9830;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pvp" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}

const amount = (inv, id, wantPreset) => inv.getItems()
  .filter((item) => item?.getId() === id && item.isPresetItem() === wantPreset)
  .reduce((total, item) => total + item.getAmount(), 0);

const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

/** The victim's death in level-11 Wilderness to `killer`: the coins it puts on the ground for the killer. */
function die(t, victim, killer) {
  const at = new core.Location(3100, 3600, 0);
  victim.p.setLocation(at);
  killer.p.setLocation(at);
  assert.ok(core.Wilderness.isIn(victim.p));
  // Skulled, so nothing is kept on death and every item reaches the per-item hook.
  core.CombatFactory.skull(victim.p, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const coins = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    if (item.getId() === I.COINS) coins.push([owner?.getUsername?.(), item.getAmount()]);
    return register.call(core.ItemOnGroundManager, owner, item, location, ...rest);
  });
  PlayerDeathTask.dropItems(victim.p, killer.p, at);
  return coins;
}

test("preset breakables pay the killer nothing on a PvP death", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  for (const [slot, id] of [I.FIRE_CAPE, I.FIGHTER_TORSO, I.DRAGON_DEFENDER].entries()) {
    victim.inv.setItem(slot, preset(new core.Item(id, 1)));
  }
  assert.deepEqual(die(t, victim, killer), []);
});

test("a real fire cape still pays the killer its repair cost", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.inv.setItem(0, new core.Item(I.FIRE_CAPE, 1));
  assert.deepEqual(die(t, victim, killer), [[killer.p.getUsername(), 150000]]);
});
