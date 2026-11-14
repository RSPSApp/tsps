process.env.DISABLE_PLAYER_BOTS = "1";
// Run after `yarn build`: node --test tests/thieving-dark-chest.test.cjs
//
// The Crumbling Tower's Dark Chest, Open with a dark key, through real object clicks on the chest the map places at
// (1928, 9448): a real Player and the real plugins. Timings and lines are the rsprox.net captures' (recordings
// 1842 and local 1000195, rev 227); the level, XP, damage cap and loot table are the Wiki's.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const CHEST_TILE = [1928, 9448, 0];
const STAND = [1929, 9448];
let core;
let I;
let chestId;
let openId;
let busyVarbit;
let next = 6700;
let clock = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(CHEST_TILE[0], CHEST_TILE[1]);
  PM.emitServerStartup({});
  chestId = core.CacheDefinitions.getLocId("sw_dungeon_key_chest_closed");
  openId = core.CacheDefinitions.getLocId("sw_dungeon_key_chest_open");
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
  player.setUsername("darkchest" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(at[0], at[1], 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.THIEVING, thieving, false).setCurrentLevels(core.Skill.THIEVING, thieving, false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { player, connection, inv: player.getInventory(), messages: [], sounds: [], animations: [], varbits: [] };
  player.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false).setCurrentLevels(core.Skill.HITPOINTS, 99, false);
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
    for (let i = 0; i < 6; i++) core.TaskManager.process();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

const chestLocation = () => new core.Location(...CHEST_TILE);
const shownIds = () => core.MapObjects.getObjectsAt(chestLocation(), null).map((o) => o.getId()).filter((id) => id === chestId || id === openId);

async function openChest(f) {
  const object = core.MapObjects.get(chestId, chestLocation(), null);
  assert.ok(object, `the map places the chest at ${CHEST_TILE}: ${shownIds()}`);
  const type = core.CacheDefinitions.getObject(chestId);
  const index = [...(type.actions ?? [])].indexOf("Open");
  assert.ok(index >= 0);
  // The walk-to runs the option on the next cycle: that cycle is tick 0, the captures' arrival tick.
  clock = -1;
  await f.connection.dispatch([{ type: "object_option", id: chestId, x: CHEST_TILE[0], y: CHEST_TILE[1], clickType: index + 1 }]);
  f.connection.processTurnPackets();
}

const Dark = () => require("../plugins/skills/thieving/DarkChest.Thieving")._test;
/** The chest's rolls answer these in order, then the last one. */
function rolls(t, values) {
  let i = 0;
  Dark().setRandom(() => values[Math.min(i++, values.length - 1)]);
  t.after(() => Dark().setRandom(null));
}

const at = (f, text) => f.messages.find(([, message]) => message === text)?.[0];
const thievingXp = (f) => f.player.getSkillManager().getExperience(core.Skill.THIEVING);
const hp = (f) => f.player.getHitpoints();
/** One cycle, with the player's queued damage landing as World.process applies it. */
function tickHits(f) {
  tick(f);
  core.World.processCycle++;
  f.player.getCombat().getHitQueue().process(core.World.processCycle);
}
const ticksHits = (f, n) => { for (let i = 0; i < n; i++) tickHits(f); };
/** The pre-rolls miss (0.99 each), then the main-table roll, then the amount roll. */
const MISS = [0.99, 0.99, 0.99];

test("an open: key line at 0, loot, key used and 1,500 XP at 1, sound 51 at 2, the slam hit and closed chest at 3 (captures)", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.DARK_KEY, 2), false);
  // The main roll lands on blood runes, the amount roll at its least; the slam at its greatest.
  const LOOT = Dark().LOOT;
  const before = LOOT.slice(0, LOOT.findIndex(([key]) => key === "BLOOD_RUNE")).reduce((sum, row) => sum + row[3], 0);
  rolls(t, [...MISS, (before + 0.5) / 600, 0, 0.999]);
  const xp = thievingXp(f);
  const hitpoints = hp(f);
  await openChest(f);
  const open = core.CacheDefinitions.getSeqId("human_openchest");
  ticksHits(f, 2); // ticks 0-1
  assert.equal(at(f, "You use a key to unlock the chest."), 0);
  assert.equal(at(f, "You steal some loot from the chest."), 1);
  assert.deepEqual(f.animations.filter(([, id]) => id >= 0), [[0, open]]);
  assert.equal(f.inv.getAmount(I.BLOOD_RUNE), 100);
  assert.equal(f.inv.getAmount(I.DARK_KEY), 1, "one key used");
  assert.equal(thievingXp(f) - xp, 1500);
  assert.deepEqual(shownIds(), [openId], "the chest shows open on the loot tick");
  tickHits(f); // 2
  assert.deepEqual(shownIds(), [openId]);
  assert.equal(hp(f), hitpoints);
  tickHits(f); // 3
  Dark().setRandom(null);
  assert.equal(at(f, "The chest slams shut on your hands."), 3);
  assert.deepEqual(shownIds(), [chestId], "closed with the slam");
  assert.equal(hitpoints - hp(f), 10, "the slam's greatest hit");
  const sounds = f.sounds.map(([tick, id, delay]) => [tick, id, delay]);
  assert.deepEqual(sounds.slice(0, 2), [[0, 52, 10], [2, 51, 15]]);
  assert.ok(sounds.some(([tick, id, delay]) => tick === 3 && id >= 509 && id <= 521 && delay === 20), `the hurt voice at 3: ${JSON.stringify(sounds)}`);
  assert.deepEqual(f.varbits, [[0, 1], [3, 0]], "busy from the key line to the slam");
});

test("the herbs, leathers and bones come noted (Wiki)", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.DARK_KEY, 1), false);
  const LOOT = Dark().LOOT;
  const before = LOOT.slice(0, LOOT.findIndex(([key]) => key === "GRIMY_TORSTOL")).reduce((sum, row) => sum + row[3], 0);
  rolls(t, [...MISS, (before + 0.5) / 600, 0.999, 0]);
  await openChest(f);
  ticksHits(f, 5);
  Dark().setRandom(null);
  const noted = core.ItemDefinition.forId(I.GRIMY_TORSTOL).getNoteId();
  assert.ok(noted > 0 && noted !== I.GRIMY_TORSTOL);
  assert.equal(f.inv.getAmount(noted), 15);
  assert.equal(f.inv.getAmount(I.DARK_KEY), 0);
});

test("a pre-roll that hits replaces the main roll (Wiki 1/600 each)", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.DARK_KEY, 1), false);
  rolls(t, [0.99, 0, 0]); // the second pre-roll: the dragon plateskirt
  await openChest(f);
  ticksHits(f, 5);
  Dark().setRandom(null);
  assert.equal(f.inv.getAmount(I.DRAGON_PLATESKIRT), 1);
  assert.equal(f.inv.getFreeSlots(), 27, "only the plateskirt, the key gone");
});

test("the tables: the main one sums to 600, the dark key comes in twos, the slam is up to 10 (Wiki)", () => {
  const { LOOT, PRE_ROLLS, DAMAGE } = Dark();
  assert.equal(LOOT.reduce((sum, row) => sum + row[3], 0), 600);
  assert.deepEqual(LOOT.find(([key]) => key === "DARK_KEY").slice(1, 4), [2, 2, 7]);
  assert.equal(PRE_ROLLS.length, 3);
  assert.equal(DAMAGE.max, 10);
});

test("below 28 Thieving nothing happens and the key stays (Wiki level and line)", async (t) => {
  const f = actor(t, { thieving: 27 });
  f.inv.add(new core.Item(I.DARK_KEY, 1), false);
  await openChest(f);
  ticksHits(f, 5);
  assert.ok(f.messages.some(([, message]) => message === "You need a Thieving level of 28 to be able to open this chest."));
  assert.equal(at(f, "You use a key to unlock the chest."), undefined);
  assert.equal(f.inv.getAmount(I.DARK_KEY), 1);
  assert.deepEqual(shownIds(), [chestId]);
});

test("without a key, or with no free slot, the chest stays shut and no XP is given", async (t) => {
  const f = actor(t);
  const xp = thievingXp(f);
  await openChest(f);
  ticksHits(f, 5);
  assert.equal(at(f, "Nothing interesting happens."), 0);
  assert.equal(at(f, "You use a key to unlock the chest."), undefined);

  const g = actor(t);
  for (let slot = 0; slot < 28; slot++) g.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
  g.inv.setItem(0, new core.Item(I.DARK_KEY, 2));
  await openChest(g);
  ticksHits(g, 5);
  assert.ok(g.messages.some(([, message]) => message === "You don't have enough inventory space to take anything from the chest."));
  assert.equal(g.inv.getAmount(I.DARK_KEY), 2);
  assert.equal(thievingXp(f), xp);
  assert.equal(thievingXp(g), xp);
  assert.deepEqual(shownIds(), [chestId]);
});

test("a second click mid-open does not use a second key", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.DARK_KEY, 3), false);
  rolls(t, [...MISS, 0.5, 0, 0]);
  await openChest(f);
  tickHits(f);
  await openChest(f);
  ticksHits(f, 5);
  Dark().setRandom(null);
  assert.equal(f.inv.getAmount(I.DARK_KEY), 2);
  assert.equal(f.messages.filter(([, message]) => message === "You use a key to unlock the chest.").length, 1);
});
