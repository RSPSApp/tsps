process.env.DISABLE_PLAYER_BOTS = "1";
// Run after `yarn build`: node --test tests/thieving-picklock-chests.test.cjs
//
// The "Picklock" chests of issue #5744 - the Aldarin villas' chests, the Sailing pirate chests and the Lizardman
// Temple's stone chests - through real object clicks on the chests the map places, with a real Player and the real
// plugins. The Aldarin timeline and lines are rsprox.net recording 1105's (rev 237, Leagues); the charts, levels, XP
// and loot tables are the Wiki's. Nothing in those chests answered the click before.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const ALDARIN = { id: "aldarin_thieving_chest", open: "aldarin_thieving_chest_open", tile: [1350, 2947, 1], stand: [1351, 2947] };
const DOGNOSE = { id: "rusty_pirate_thieving_chest_dognose", open: "rusty_pirate_thieving_chest_open", tile: [3054, 2650, 0], stand: [3054, 2651] };
const CROWN_JEWEL = { id: "tarnished_pirate_thieving_chest_crown_jewel", open: "tarnished_pirate_thieving_chest_open", tile: [1762, 2670, 0], stand: [1762, 2669] };
const YNYSDAIL = { id: "reinforced_pirate_thieving_chest_ynysdail", open: "reinforced_pirate_thieving_chest_open", tile: [2211, 3473, 0], stand: [2211, 3472] };
const LIZARDMAN = { id: "molch_temple_chest_theiving", open: "molch_temple_chest_theiving_open", tile: [1300, 10085, 0], stand: [1300, 10086] };
let core;
let I;
let busyVarbit;
let next = 7600;
let clock = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  for (const chest of [ALDARIN, DOGNOSE, CROWN_JEWEL, YNYSDAIL, LIZARDMAN]) {
    core.RegionManager.loadMapFiles(chest.tile[0], chest.tile[1]);
    chest.closedId = core.CacheDefinitions.getLocId(chest.id);
    chest.openId = core.CacheDefinitions.getLocId(chest.open);
  }
  core.RegionManager.loadMapFiles(1373, 2939);
  core.RegionManager.loadMapFiles(1378, 2968);
  PM.emitServerStartup({});
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

function actor(t, chest, { thieving = 99 } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("picklock" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(chest.stand[0], chest.stand[1], chest.tile[2]));
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
    Chests().setRandom(null);
  });
  return f;
}

const Chests = () => require("../plugins/skills/thieving/PicklockChests.Thieving")._test;
const chestLocation = (chest) => new core.Location(...chest.tile);
const shownIds = (chest) => core.MapObjects.getObjectsAt(chestLocation(chest), null).map((o) => o.getId()).filter((id) => id === chest.closedId || id === chest.openId);

async function picklock(f, chest) {
  const object = core.MapObjects.get(chest.closedId, chestLocation(chest), null);
  assert.ok(object, `the map places ${chest.id} at ${chest.tile}: ${shownIds(chest)}`);
  const index = [...(core.CacheDefinitions.getObject(chest.closedId).actions ?? [])].indexOf("Picklock");
  assert.ok(index >= 0, "the cache offers Picklock");
  // The walk-to runs the option on the next cycle: that cycle is tick 0, the capture's arrival tick.
  clock = -1;
  await f.connection.dispatch([{ type: "object_option", id: chest.closedId, x: chest.tile[0], y: chest.tile[1], clickType: index + 1 }]);
  f.connection.processTurnPackets();
}

/** The chest's rolls answer these in order, then the last one. */
function rolls(t, values) {
  let i = 0;
  Chests().setRandom(() => values[Math.min(i++, values.length - 1)]);
  t.after(() => Chests().setRandom(null));
}

const at = (f, text) => f.messages.find(([, message]) => message === text)?.[0];
const thievingXp = (f) => f.player.getSkillManager().getExperience(core.Skill.THIEVING);
const settle = (f) => ticks(f, 8);

test("an Aldarin unlock: attempt, unlock 2 ticks on, loot and 200 XP on the third, the chest open for 2 ticks (recording 1105)", async (t) => {
  const f = actor(t, ALDARIN);
  rolls(t, [0, 0.5, 0]); // unlocks; the table roll lands on the first coins row; its least amount
  const xp = thievingXp(f);
  await picklock(f, ALDARIN);
  const lockedChest = core.CacheDefinitions.getSeqId("human_lockedchest");
  const openChest = core.CacheDefinitions.getSeqId("human_openchest");
  assert.equal([lockedChest, openChest].join(), "537,536", "the recording's animation ids");
  ticks(f, 4); // ticks 0-3
  Chests().setRandom(null);
  assert.equal(at(f, "You attempt to picklock the chest."), 0);
  assert.equal(at(f, "You manage to unlock the chest."), 2);
  assert.equal(at(f, "You steal some loot from the chest."), 3);
  assert.deepEqual(f.animations.filter(([, id]) => id >= 0), [[0, lockedChest], [2, openChest]]);
  assert.ok(f.inv.getAmount(I.COINS) >= 100 && f.inv.getAmount(I.COINS) <= 200);
  assert.equal(thievingXp(f) - xp, 200);
  assert.deepEqual(shownIds(ALDARIN), [ALDARIN.openId], "the chest shows open on the loot tick");
  ticks(f, 2); // 4-5
  assert.deepEqual(shownIds(ALDARIN), [ALDARIN.closedId], "and closed 2 ticks later");
  assert.deepEqual(f.sounds.map(([tick, id, delay]) => [tick, id, delay]), [[0, 1243, 0], [2, 52, 10], [4, 51, 15]]);
  assert.deepEqual(f.varbits, [[1, 1], [5, 0]], "busy from the tick after the click to the chest closing");
});

test("an Aldarin failed roll: the fail line and sound 2 ticks on, no loot, no XP, the player stays", async (t) => {
  const f = actor(t, ALDARIN);
  rolls(t, [0.99, 0.99]); // the unlock roll fails, the well roll misses
  const xp = thievingXp(f);
  await picklock(f, ALDARIN);
  settle(f);
  assert.equal(at(f, "You fail to picklock the chest."), 2);
  assert.ok(f.sounds.some(([tick, id]) => tick === 2 && id === 2402));
  assert.equal(thievingXp(f), xp);
  assert.equal(f.inv.getFreeSlots(), 28);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], ALDARIN.stand);
  assert.deepEqual(shownIds(ALDARIN), [ALDARIN.closedId]);
});

test("an Aldarin failed roll can teleport the player to a walkable tile beside the nearest well (Wiki)", async (t) => {
  const f = actor(t, ALDARIN);
  rolls(t, [0.99, 0, 0.5]); // fails, the well roll hits, the tile pick
  await picklock(f, ALDARIN);
  ticks(f, 7);
  const here = f.player.getLocation();
  const wells = Chests().WELLS;
  const near = wells.find(([x, y]) => here.getX() >= x - 1 && here.getX() <= x + 2 && here.getY() >= y - 1 && here.getY() <= y + 2);
  assert.ok(near, `landed at ${here.getX()}, ${here.getY()}, not beside a well`);
  assert.deepEqual(near, [1373, 2939], "the well nearest the chest at 1350,2947");
  assert.equal(here.getZ(), 0);
  assert.equal(core.RegionManager.blocked(here, null), false);
  assert.equal(f.varbits.at(-1)[1], 0, "busy is cleared");
});

test("below the chest's Thieving level nothing is attempted (Wiki level)", async (t) => {
  for (const [chest, level] of [[ALDARIN, 36], [DOGNOSE, 33], [CROWN_JEWEL, 54], [YNYSDAIL, 76], [LIZARDMAN, 64]]) {
    const f = actor(t, chest, { thieving: level - 1 });
    await picklock(f, chest);
    settle(f);
    assert.equal(at(f, "You attempt to picklock the chest."), undefined, chest.id);
    assert.ok(f.messages.some(([, message]) => message === `You need a Thieving level of at least ${level} to do this.`), chest.id);
  }
});

test("the charts: the Wiki's percentages at the charted levels, a lockpick adding 25/256 (never needed)", () => {
  const { KINDS, successChance, teleportChance } = Chests();
  const kind = (key) => KINDS.find((k) => k.key === key);
  const pct = (key, level, lockpick) => successChance(kind(key), level, lockpick) * 100;
  const wiki = [
    ["aldarin", 36, false, 21.5], ["aldarin", 99, false, 59], ["aldarin", 36, true, 31.25], ["aldarin", 99, true, 68.75],
    ["rusty", 33, false, 18.75], ["rusty", 99, false, 60.9], ["rusty", 33, true, 28.5], ["rusty", 99, true, 70.7],
    ["tarnished", 54, false, 32.4], ["tarnished", 99, false, 60.9], ["tarnished", 54, true, 42.2], ["tarnished", 99, true, 70.7],
    ["reinforced", 76, false, 46.1], ["reinforced", 99, false, 60.9], ["reinforced", 76, true, 55.9], ["reinforced", 99, true, 70.7],
    ["lizardman", 64, false, 31.25], ["lizardman", 99, false, 60.55], ["lizardman", 64, true, 41], ["lizardman", 99, true, 70.3],
  ];
  for (const [key, level, lockpick, expected] of wiki) {
    assert.ok(Math.abs(pct(key, level, lockpick) - expected) < 0.3, `${key} ${level} ${lockpick}: ${pct(key, level, lockpick)} against ${expected}`);
  }
  assert.ok(Math.abs(teleportChance(kind("aldarin"), 36) - 0.211) < 1e-9);
  assert.ok(Math.abs(teleportChance(kind("aldarin"), 99) - 0.0703) < 1e-9);
  assert.equal(teleportChance(kind("rusty"), 33), 0, "the pirate chests' teleport is not implemented (no destination in the Wiki)");
});

test("every loot row resolves to an item, and the tables carry the Wiki's weights", () => {
  const { KINDS, GEMS, FRAGS, BOLT_TIPS, SEEDS } = Chests();
  const sub = { GEM: GEMS, FRAGS, BOLT_TIPS, SEED: SEEDS };
  for (const kind of KINDS) {
    for (const [key] of kind.loot) {
      const keys = sub[key] ? sub[key].map(([k]) => k) : [key];
      for (const itemKey of keys) {
        if (itemKey === "CLUE_MEDIUM") continue;
        assert.equal(typeof I[itemKey], "number", `${kind.key}: ${itemKey} is an item`);
      }
    }
    for (const pre of kind.pre) assert.equal(typeof I[pre.clue ? `CLUE_SCROLL_${pre.clue.toUpperCase()}_` : pre.item], "number", kind.key);
  }
  const total = (key) => KINDS.find((k) => k.key === key).loot.reduce((sum, row) => sum + row[3], 0);
  assert.equal(total("aldarin"), 60);
  assert.equal(total("lizardman"), 300);
  for (const key of ["rusty", "tarnished", "reinforced"]) assert.equal(total(key), 59, "the pages' rows add to 59");
});

test("the Dognose chest: the Medallion fragment first (1 in 4) unless the player has one; a pirate chest gives its tier's XP", async (t) => {
  const f = actor(t, DOGNOSE);
  rolls(t, [0, 0]); // unlocks; the Medallion fragment roll hits
  const xp = thievingXp(f);
  await picklock(f, DOGNOSE);
  settle(f);
  Chests().setRandom(null);
  assert.equal(f.inv.getAmount(I.MEDALLION_FRAGMENT), 1);
  assert.equal(thievingXp(f) - xp, 90);

  const g = actor(t, DOGNOSE);
  g.inv.add(new core.Item(I.MEDALLION_FRAGMENT, 1), false);
  rolls(t, [0, 0.99, 0, 0]); // unlocks; the fragment is skipped without a roll (they own one); no clue; the first row, the dagger
  await picklock(g, DOGNOSE);
  settle(g);
  Chests().setRandom(null);
  assert.equal(g.inv.getAmount(I.MEDALLION_FRAGMENT), 1, "no second fragment");
  assert.equal(g.inv.getAmount(I.STEEL_DAGGER), 1);
});

test("the tarnished and reinforced chests pay 122.5 and 182.5 XP and roll their tier's table", async (t) => {
  const f = actor(t, CROWN_JEWEL, { thieving: 54 });
  rolls(t, [0, 0.99, 0, 0]); // unlocks; no clue; the first row; its least amount
  const xp = thievingXp(f);
  await picklock(f, CROWN_JEWEL);
  settle(f);
  Chests().setRandom(null);
  assert.equal(f.inv.getAmount(I.MITHRIL_DAGGER), 1);
  assert.ok(Math.abs(thievingXp(f) - xp - 122.5) <= 0.5, "122.5 XP (experience is whole points here)");

  const g = actor(t, YNYSDAIL, { thieving: 76 });
  rolls(t, [0, 0.99, 0, 0]);
  const gxp = thievingXp(g);
  await picklock(g, YNYSDAIL);
  settle(g);
  Chests().setRandom(null);
  assert.equal(g.inv.getAmount(I.ADAMANT_DAGGER), 1);
  assert.ok(Math.abs(thievingXp(g) - gxp - 182.5) <= 0.5, "182.5 XP (experience is whole points here)");
});

test("a Lizardman Temple chest: 280 XP and a roll of its table, opening and closing like the others", async (t) => {
  const f = actor(t, LIZARDMAN);
  rolls(t, [0, 0, 0, 0]); // unlocks; the bolt tips row; the opal tips; the fewest
  const xp = thievingXp(f);
  await picklock(f, LIZARDMAN);
  ticks(f, 4);
  Chests().setRandom(null);
  assert.equal(f.inv.getAmount(I.OPAL_BOLT_TIPS), 4);
  assert.equal(thievingXp(f) - xp, 280);
  assert.deepEqual(shownIds(LIZARDMAN), [LIZARDMAN.openId]);
  ticks(f, 2);
  assert.deepEqual(shownIds(LIZARDMAN), [LIZARDMAN.closedId]);
});

test("loot that does not fit is not given, though the XP is", async (t) => {
  const f = actor(t, ALDARIN);
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
  rolls(t, [0, 0.2, 0]); // unlocks; a coins row: no room for a new stack
  const xp = thievingXp(f);
  await picklock(f, ALDARIN);
  settle(f);
  Chests().setRandom(null);
  assert.equal(f.inv.getAmount(I.COINS), 0);
  assert.equal(thievingXp(f) - xp, 200);
});
