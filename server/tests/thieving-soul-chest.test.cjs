process.env.DISABLE_PLAYER_BOTS = "1";
// Run after `yarn build`: node --test tests/thieving-soul-chest.test.cjs
//
// The Isle of Souls Dungeon chest's Picklock, through real object clicks on the chest the map places at
// (2139, 9299): a real Player and the real plugins. Timings and lines are the rsprox.net captures' (recordings
// 91, 92, 95, 1842, rev 227); the level, XP, success chart, trap chance and loot table are the Wiki's.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const CHEST_TILE = [2139, 9299, 0];
const STAND = [2139, 9298];
let core;
let I;
let chestId;
let openId;
let busyVarbit;
let next = 6600;
let clock = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(CHEST_TILE[0], CHEST_TILE[1]);
  core.RegionManager.loadMapFiles(2324, 2933);
  PM.emitServerStartup({});
  chestId = core.CacheDefinitions.getLocId("sw_dungeon_thieving_chest_closed");
  openId = core.CacheDefinitions.getLocId("sw_dungeon_thieving_chest_open");
  busyVarbit = core.CacheDefinitions.getVarbitId("busy");
});
after(() => PM.emitServerShutdown({}));

/** One game cycle in World.process's order: the tasks, then the player's movement and walk-to. */
function tick(f) {
  clock++;
  core.TaskManager.process();
  f.player.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.player.getIndex());
}
const ticks = (f, n) => { for (let i = 0; i < n; i++) tick(f); };

function actor(t, { thieving = 99, at = STAND } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("soulchest" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(at[0], at[1], 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.THIEVING, thieving, false).setCurrentLevels(core.Skill.THIEVING, thieving, false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { player, connection, inv: player.getInventory(), messages: [], sounds: [], animations: [], varbits: [] };
  const sender = player.getPacketSender();
  const sendMessage = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => { f.messages.push([clock, message]); return sendMessage(message); };
  const sendTyped = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, message, ...rest) => { f.messages.push([clock, message]); return sendTyped(type, message, ...rest); };
  const sendEffect = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, loops, delay, ...rest) => { f.sounds.push([clock, id, delay]); return sendEffect(id, loops, delay, ...rest); };
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { if (id === busyVarbit) f.varbits.push([clock, value]); return sendVarbit(id, value); };
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { f.animations.push([clock, animation.getId()]); return perform(animation); };
  t.after(() => {
    // Let any open chest close before the next test.
    for (let i = 0; i < 4; i++) core.TaskManager.process();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

const chestLocation = () => new core.Location(...CHEST_TILE);
const shownIds = () => core.MapObjects.getObjectsAt(chestLocation(), null).map((o) => o.getId()).filter((id) => id === chestId || id === openId);

async function picklock(f) {
  const object = core.MapObjects.get(chestId, chestLocation(), null);
  assert.ok(object, `the map places the chest at ${CHEST_TILE}: ${shownIds()}`);
  const type = core.CacheDefinitions.getObject(chestId);
  const index = [...(type.actions ?? [])].indexOf("Picklock");
  assert.ok(index >= 0);
  // The walk-to runs the option on the next cycle: that cycle is tick 0, the captures' arrival tick.
  clock = -1;
  await f.connection.dispatch([{ type: "object_option", id: chestId, x: CHEST_TILE[0], y: CHEST_TILE[1], clickType: index + 1 }]);
  f.connection.processTurnPackets();
}

const Soul = () => require("../plugins/skills/thieving/SoulChest.Thieving")._test;
/** The chest's rolls answer these in order, then the last one. */
function rolls(t, values) {
  let i = 0;
  Soul().setRandom(() => values[Math.min(i++, values.length - 1)]);
  t.after(() => Soul().setRandom(null));
}

const at = (f, text) => f.messages.find(([, message]) => message === text)?.[0];
const thievingXp = (f) => f.player.getSkillManager().getExperience(core.Skill.THIEVING);
const settle = (f) => ticks(f, 8);

test("an unlock: attempt, unlock 2 ticks on, loot and 150 XP on the third, the chest open for 2 ticks (captures)", async (t) => {
  const f = actor(t);
  rolls(t, [0]); // unlocks; the first row of the table (coins), its least amount
  const xp = thievingXp(f);
  await picklock(f);
  const lockedChest = core.CacheDefinitions.getSeqId("human_lockedchest");
  const openChest = core.CacheDefinitions.getSeqId("human_openchest");
  ticks(f, 4); // ticks 0-3
  Soul().setRandom(null);
  assert.equal(at(f, "You attempt to picklock the chest."), 0);
  assert.equal(at(f, "You manage to unlock the chest."), 2);
  assert.equal(at(f, "You steal some loot from the chest."), 3);
  assert.deepEqual(f.animations.filter(([, id]) => id >= 0), [[0, lockedChest], [2, openChest]]);
  assert.equal(f.inv.getAmount(I.COINS), 90);
  assert.equal(thievingXp(f) - xp, 150);
  assert.deepEqual(shownIds(), [openId], "the chest shows open on the loot tick");
  ticks(f, 2); // 4-5
  assert.deepEqual(shownIds(), [chestId], "and closed 2 ticks later");
  assert.deepEqual(f.sounds.map(([tick, id, delay]) => [tick, id, delay]), [[0, 1243, 0], [2, 52, 10], [4, 51, 15]]);
  assert.deepEqual(f.varbits, [[1, 1], [5, 0]], "busy from the tick after the click to the chest closing");
  assert.equal(at(f, "You fail to picklock the chest."), undefined);
});

test("a failed roll: the fail line and sound 2 ticks on, no loot, no XP, the player stays (captures)", async (t) => {
  const f = actor(t);
  rolls(t, [0.99, 0.99]); // the unlock roll fails, the trap roll misses
  const xp = thievingXp(f);
  await picklock(f);
  settle(f);
  Soul().setRandom(null);
  assert.equal(at(f, "You fail to picklock the chest."), 2);
  assert.ok(f.sounds.some(([tick, id]) => tick === 2 && id === 2402));
  assert.equal(at(f, "You have activated a trap on the chest."), undefined);
  assert.equal(thievingXp(f), xp);
  assert.equal(f.inv.getFreeSlots(), 28);
  assert.deepEqual(f.varbits, [[1, 1], [2, 0]]);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], STAND);
  assert.deepEqual(shownIds(), [chestId]);
});

test("a sprung trap: the teleport cast with the fail line, the trap line at 4, landing north-east of the entrance at 5 (captures)", async (t) => {
  const f = actor(t);
  rolls(t, [0.99, 0.0, 0.5]); // fails, the trap springs, the landing tile's rolls
  await picklock(f);
  ticks(f, 5); // ticks 0-4
  assert.equal(at(f, "You fail to picklock the chest."), 2);
  assert.ok(f.animations.some(([tick, id]) => tick === 2 && id === core.CacheDefinitions.getSeqId("human_castteleport")));
  assert.equal(at(f, "You have activated a trap on the chest."), 4);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], STAND, "still at the chest on tick 4");
  tick(f);
  Soul().setRandom(null);
  const { x, y } = { x: f.player.getLocation().getX(), y: f.player.getLocation().getY() };
  assert.ok(x >= 2321 && x <= 2327 && y >= 2930 && y <= 2936, `landed at ${x}, ${y}`);
  assert.equal(f.player.getLocation().getZ(), 0);
  assert.deepEqual(f.varbits, [[1, 1], [5, 0]]);
});

test("a sprung trap never lands on the square's blocked tiles (2321,2930 and 2321,2931)", async (t) => {
  for (const pick of [0, 0.999]) {
    const f = actor(t);
    rolls(t, [0.99, 0.0, pick]); // fails, springs, the first or last walkable tile
    await picklock(f);
    ticks(f, 6);
    Soul().setRandom(null);
    const at = f.player.getLocation();
    assert.equal(core.RegionManager.blocked(at, null), false, `landed on a blocked tile ${at.getX()}, ${at.getY()}`);
    assert.ok(at.getX() >= 2321 && at.getX() <= 2327 && at.getY() >= 2930 && at.getY() <= 2936);
  }
});

test("below 28 Thieving nothing is attempted (Wiki level)", async (t) => {
  const f = actor(t, { thieving: 27 });
  await picklock(f);
  settle(f);
  assert.equal(at(f, "You attempt to picklock the chest."), undefined);
  assert.ok(f.messages.some(([, message]) => message === "You need a Thieving level of at least 28 to do this."));
});

test("loot that does not fit is not given, though the XP is (Wiki: nothing with too little room)", async (t) => {
  const f = actor(t);
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
  f.inv.setItem(0, new core.Item(I.COINS, 5));
  // The unlock roll, then a roll landing on the mithril pickaxe (unstackable, no room).
  const LOOT = Soul().LOOT;
  const before = LOOT.slice(0, LOOT.findIndex(([key]) => key === "MITHRIL_PICKAXE")).reduce((sum, row) => sum + row[3], 0);
  rolls(t, [0, (before + 0.5) / 200, 0]);
  const xp = thievingXp(f);
  await picklock(f);
  settle(f);
  Soul().setRandom(null);
  assert.equal(f.inv.getAmount(I.MITHRIL_PICKAXE), 0);
  assert.equal(thievingXp(f) - xp, 150);

  // Coins join the stack already held.
  const g = actor(t);
  for (let slot = 0; slot < 28; slot++) g.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
  g.inv.setItem(0, new core.Item(I.COINS, 5));
  rolls(t, [0]);
  await picklock(g);
  settle(g);
  Soul().setRandom(null);
  assert.equal(g.inv.getAmount(I.COINS), 95);
});

test("the success chart: -23/153 out of 256, a lockpick +26 (Wiki, Mod Ash)", () => {
  const { successChance, LOOT } = require("../plugins/skills/thieving/SoulChest.Thieving")._test;
  assert.equal(successChance(99, false), 154 / 256, "60% at 99");
  assert.equal(successChance(99, true), 180 / 256);
  assert.equal(successChance(1, false), 0, "below zero at 1");
  assert.equal(successChance(28, false), (1 + Math.floor(-23 * 71 / 98 + 153 * 27 / 98 + 0.5)) / 256);
  assert.equal(LOOT.reduce((sum, row) => sum + row[3], 0), 200, "the table is out of 200");
});

test("a lockpick in the pack raises the unlock chance", async (t) => {
  const f = actor(t, { thieving: 28 });
  f.inv.add(new core.Item(I.LOCKPICK, 1), false);
  const { successChance } = require("../plugins/skills/thieving/SoulChest.Thieving")._test;
  // A roll between the bare and the lockpick chance unlocks only with the lockpick.
  rolls(t, [(successChance(28, false) + successChance(28, true)) / 2, 0]);
  await picklock(f);
  settle(f);
  Soul().setRandom(null);
  assert.equal(at(f, "You manage to unlock the chest."), 2);
});
