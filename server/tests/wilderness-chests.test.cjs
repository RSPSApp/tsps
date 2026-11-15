process.env.DISABLE_PLAYER_BOTS = "1"; // no player bots in the world while the chests are clicked
// Run after `yarn build`: node --test tests/wilderness-chests.test.cjs
//
// The Wilderness diary's Muddy chest (Medium) and Rogues' chest (Elite), through real object clicks: a real
// Player, the real plugins (the diary, the chests), and chest objects placed in the Wilderness on the real map.
//
// Rogues' chest, rsprox 462 and 463 (rev 233), by loc id 26757/26758: Open (oploc1) gives "You have activated a
// trap on the chest." with animation 537, sound 2400, then a hit and sound 518; Search for traps (oploc2) gives,
// on the click tick, "You search the chest for traps." and "You find a trap on the chest." with animation 537, 2
// ticks later "You disable the trap." (sound 2402), 4 ticks later "You open the chest." (animation 537, sound 52),
// 6 ticks later "You find some <item> inside." (animation 536), the chest turning 26758 and 702 Thieving XP,
// and the chest back to 26757 34 ticks after that. The loot tables are the Wiki's (no capture shows the Muddy
// chest, which has the diary journal, rsprox 1185, only).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

// A Wilderness tile with no NPC spawns within 30 tiles, so nothing attacks during the clicks.
const WILD = [2990, 3800];
const MUDDY_CHEST = 170;
const ROGUES_CHEST = 26757;
const ROGUES_CHEST_OPEN = 26758;
const MUDDY_TASK = "open-the-muddy-chest-in-the-lava-maze";
const ROGUES_TASK = "steal-from-the-rogues-chest";
let core;
let I;
let next = 6400;
let clock = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...WILD);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/**
 * One game cycle in World.process's order: the tasks first (a task a handler scheduled last cycle is ticked now,
 * so a 2-tick countdown fires two cycles after the handler), then the player's turn (movement, then the walk-to
 * that runs the interaction).
 */
function tick(f) {
  clock++;
  core.TaskManager.process();
  f.player.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.player.getIndex());
}
const ticks = (f, n) => { for (let i = 0; i < n; i++) tick(f); };

function actor(t, { thieving = 99, at = [WILD[0] - 1, WILD[1]] } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("wchest" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(at[0], at[1], 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.THIEVING, thieving, false).setCurrentLevels(core.Skill.THIEVING, thieving, false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { player, connection, inv: player.getInventory(), messages: [], sounds: [], animations: [] };
  const sender = player.getPacketSender();
  const sendMessage = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => { f.messages.push([clock, message]); return sendMessage(message); };
  const sendSound = sender.sendSound.bind(sender);
  sender.sendSound = (id, volume, delay) => { f.sounds.push([clock, id, delay]); return sendSound(id, volume, delay); };
  // Every inventory the client is shown, as the ids it holds (an inventory copy used for planning must never be).
  f.shown = [];
  const sendItemContainer = sender.sendItemContainer.bind(sender);
  sender.sendItemContainer = (container, interfaceId, ...rest) => {
    if (interfaceId === core.Inventory.INTERFACE_ID) f.shown.push(container.getItems().map((item) => item?.getId?.() ?? -1));
    return sendItemContainer(container, interfaceId, ...rest);
  };
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { f.animations.push([clock, animation.getId()]); return perform(animation); };
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

/** A chest on the map beside the player; the click is a real object_option packet. */
function chestAt(t, id, at = [WILD[0] + 1, WILD[1]]) {
  const object = new core.GameObject(id, new core.Location(at[0], at[1], 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => {
    try { core.ObjectManager.deregister(object, true); } catch { /* already swapped out */ }
    for (const shown of core.ObjectManager.objectsAt(object.getLocation())) {
      try { core.ObjectManager.deregister(shown, true); } catch { /* gone */ }
    }
  });
  return object;
}

async function click(f, object, option) {
  const type = core.CacheDefinitions.getObject(object.getId());
  const index = [...(type.actions ?? [])].indexOf(option);
  assert.ok(index >= 0, `${option} in ${JSON.stringify([...(type.actions ?? [])])} for ${object.getId()}`);
  const at = object.getLocation();
  await f.connection.dispatch([{ type: "object_option", id: object.getId(), x: at.getX(), y: at.getY(), clickType: index + 1 }]);
  f.connection.processTurnPackets();
}

const credited = (f, task) => {
  const query = { player: f.player, diary: "wilderness", task, done: false };
  PM.emitCustomEvent("diary:has-task", query);
  return query.done === true;
};

function completeTier(f, tier) {
  const data = require("../plugins/achievements/diaries/data/achievement-diaries.json").diaries.find((d) => d.key === "wilderness");
  for (const task of data.tiers[tier].tasks) PM.emitCustomEvent("diary:task", { player: f.player, diary: "wilderness", task: task.key });
}

const noted = (id) => core.ItemDefinition.forId(id).getNoteId();
const count = (f, id) => f.inv.getAmount(id);
const shownIds = (object) => core.ObjectManager.objectsAt(object.getLocation()).map((o) => o.getId());
const fill = (f, free) => {
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, slot < 28 - free ? new core.Item(I.TINDERBOX, 1) : new core.Item(-1, 0));
};
const textAt = (f, text) => f.messages.find(([, message]) => message === text)?.[0];

// ------------------------------------------------------------------ Muddy chest

test("the Muddy chest takes a muddy key, gives its guaranteed loot and credits the diary task", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.MUDDY_KEY, 2), false);
  await click(f, chestAt(t, MUDDY_CHEST), "Open");
  ticks(f, 12);
  assert.equal(count(f, I.MUDDY_KEY), 1, "one key is used up");
  assert.equal(count(f, I.UNCUT_RUBY), 1);
  assert.equal(count(f, noted(I.MITHRIL_BAR)), 2, "two mithril bars, noted");
  assert.equal(count(f, I.LAW_RUNE), 5);
  assert.equal(count(f, I.DEATH_RUNE), 5);
  assert.equal(count(f, I.CHAOS_RUNE), 15);
  assert.ok(credited(f, MUDDY_TASK), "the diary task is credited");
});

test("the Muddy chest without a key gives nothing and credits nothing", async (t) => {
  const f = actor(t);
  await click(f, chestAt(t, MUDDY_CHEST), "Open");
  ticks(f, 12);
  assert.equal(count(f, I.UNCUT_RUBY), 0);
  assert.equal(credited(f, MUDDY_TASK), false);
});

test("the Muddy chest decides room before it rolls: a refusal never depends on the extra roll", async (t) => {
  // Five guaranteed items need five free slots and the extra roll one more, whatever it turns out to be; using
  // the last key up frees its own slot. So 5 free plus the key opens, 4 free plus the key refuses, on any roll.
  const outcome = async (free, roll, y) => {
    const f = actor(t);
    t.mock.method(Math, "random", () => roll);
    fill(f, free);
    f.inv.setItem(0, new core.Item(I.MUDDY_KEY, 1));
    f.player.setLocation(new core.Location(WILD[0], WILD[1] + y, 0));
    await click(f, chestAt(t, MUDDY_CHEST, [WILD[0] + 1, WILD[1] + y]), "Open");
    ticks(f, 12);
    t.mock.restoreAll();
    return count(f, I.UNCUT_RUBY) === 1;
  };
  assert.equal(await outcome(5, 0.0, 0), true, "5 free + the key opens when the extra rolls");
  assert.equal(await outcome(5, 0.99, 2), true, "and when it does not");
  assert.equal(await outcome(4, 0.0, 4), false, "4 free + the key refuses when the extra rolls");
  assert.equal(await outcome(4, 0.99, 6), false, "and when it does not: the refusal reveals nothing");
});

test("the Muddy chest opens with exactly the room it needs and keeps the key when there is one slot less", async (t) => {
  const open = actor(t);
  open.inv.add(new core.Item(I.MUDDY_KEY, 1), false);
  fill(open, 5);
  open.inv.setItem(0, new core.Item(I.MUDDY_KEY, 1)); // the key is the only slot it frees
  await click(open, chestAt(t, MUDDY_CHEST), "Open");
  ticks(open, 12);
  assert.equal(count(open, I.UNCUT_RUBY), 1, "five free slots plus the key's own is enough");

  const full = actor(t);
  fill(full, 3);
  full.inv.setItem(0, new core.Item(I.MUDDY_KEY, 1));
  await click(full, chestAt(t, MUDDY_CHEST, [WILD[0] + 1, WILD[1] + 3]), "Open");
  ticks(full, 12);
  assert.equal(count(full, I.UNCUT_RUBY), 0);
  assert.equal(count(full, I.MUDDY_KEY), 1, "the key is kept");
  assert.equal(credited(full, MUDDY_TASK), false);
});

test("a full pack keeps the key on the client too: the refusal shows no inventory without it (issue 4684)", async (t) => {
  // The room check plans on a copy of the inventory with the key taken out; that copy was sent to the client, so
  // the key looked used up although the refusal kept it.
  const f = actor(t);
  fill(f, 2);
  f.inv.setItem(0, new core.Item(I.MUDDY_KEY, 1));
  f.shown.length = 0;
  await click(f, chestAt(t, MUDDY_CHEST), "Open");
  ticks(f, 12);
  assert.ok(f.messages.some(([, message]) => message === "You need more inventory space to open the chest."));
  assert.equal(count(f, I.MUDDY_KEY), 1, "the key is kept");
  assert.deepEqual(f.shown.filter((ids) => !ids.includes(I.MUDDY_KEY)), [], "the client is never shown the pack without the key");
  assert.equal(credited(f, MUDDY_TASK), false);
});

test("the Muddy chest plans its room on the real stacks: a preset rune stack needs a slot of its own and the key is kept", async (t) => {
  // Slot 0 the key, slot 1 a preset law rune stack (the same id, a different stack), 22 tinderboxes: 4 free.
  // The key frees one, so 5 are there; the five guaranteed items need five new slots (the preset stack cannot
  // take the plain runes) and the extra roll one more.
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.MUDDY_KEY, 1));
  const preset = new core.Item(I.LAW_RUNE, 100);
  preset.setMetaValue(core.Item.PRESET_META, true);
  f.inv.setItem(1, preset);
  for (let slot = 2; slot < 24; slot++) f.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
  for (let slot = 24; slot < 28; slot++) f.inv.setItem(slot, new core.Item(-1, 0));
  await click(f, chestAt(t, MUDDY_CHEST), "Open");
  ticks(f, 12);
  assert.equal(count(f, I.MUDDY_KEY), 1, "the key is kept");
  assert.equal(count(f, I.UNCUT_RUBY), 0, "and nothing was half given");
  assert.equal(count(f, I.LAW_RUNE), 100, "the preset stack is untouched");
  assert.equal(credited(f, MUDDY_TASK), false);
});

test("the Muddy chest keeps the key when a rune stack is too full to take the loot", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.MUDDY_KEY, 1));
  f.inv.setItem(1, new core.Item(I.LAW_RUNE, 2147483647 - 2)); // 2 more fit, 5 are owed
  await click(f, chestAt(t, MUDDY_CHEST), "Open");
  ticks(f, 12);
  assert.equal(count(f, I.MUDDY_KEY), 1, "the key is kept");
  assert.equal(count(f, I.UNCUT_RUBY), 0);
  assert.equal(count(f, I.LAW_RUNE), 2147483647 - 2, "and the stack loses nothing");
});

test("the Muddy chest is not members-only; only its extra roll and the Rogues' chest are (Wiki)", () => {
  const plugin = require("../plugins/items/WildernessChests.plugin");
  assert.notEqual(plugin.members, true, "the plugin loads on a free-to-play world");
  assert.equal(plugin._test.muddyLoot(() => 0, false).length, 5, "no extra roll on a free world, even on the luckiest roll");
  assert.equal(plugin._test.muddyLoot(() => 0, true).length, 6);
});

test("the Muddy chest's extra roll is 3/40 of openings, one item by weight (Wiki)", () => {
  const Chests = require("../plugins/items/WildernessChests.plugin")._test;
  assert.equal(Chests.muddyLoot(() => 0.5, true).length, 5, "the five guaranteed items and no extra");
  let step = 0;
  const rolls = [0.01, 0.0];
  const lucky = Chests.muddyLoot(() => rolls[step++] ?? 0, true);
  assert.equal(lucky.length, 6);
  assert.equal(lucky[5].getId(), noted(I.BLIGHTED_MANTA_RAY));
  assert.equal(lucky[5].getAmount(), 25);
  const values = [0.01, 0.999];
  assert.equal(Chests.muddyLoot(() => values.shift() ?? 0.999, true)[5].getId(), I.LARRANS_KEY_2);
});

// ------------------------------------------------------------------ Rogues' chest

test("Search for traps plays the captured sequence and gives the loot on the sixth tick", async (t) => {
  const f = actor(t, { thieving: 99 });
  completeTier(f, "medium");
  t.mock.method(Math, "random", () => 0.001); // the first row: nature runes
  const object = chestAt(t, ROGUES_CHEST);
  const xp = f.player.getSkillManager().getExperience(core.Skill.THIEVING);
  await click(f, object, "Search for traps");
  ticks(f, 3);
  const start = textAt(f, "You search the chest for traps.");
  assert.ok(start !== undefined, `the search begins: ${JSON.stringify(f.messages)}`);
  ticks(f, 8);
  assert.equal(textAt(f, "You find a trap on the chest."), start, "both on the click tick");
  assert.equal(textAt(f, "You disable the trap."), start + 2);
  assert.equal(textAt(f, "You open the chest."), start + 4);
  assert.equal(textAt(f, "You find some nature runes inside."), start + 6);
  assert.deepEqual(f.animations.map(([tickNo, id]) => [tickNo - start, id]), [[0, 537], [4, 537], [6, 536]]);
  assert.deepEqual(f.sounds.map(([tickNo, id]) => [tickNo - start, id]), [[2, 2402], [4, 52]]);
  assert.equal(count(f, I.NATURE_RUNE), 40, "the Medium table's first row");
  assert.ok(f.player.getSkillManager().getExperience(core.Skill.THIEVING) - xp >= 701, "701.7 Thieving experience");
  assert.ok(credited(f, ROGUES_TASK), "the Elite task is credited on the loot tick");
  assert.ok(shownIds(object).includes(ROGUES_CHEST_OPEN), "the chest shows open");
  const looted = start + 6;
  while (clock < looted + 33) tick(f);
  assert.ok(shownIds(object).includes(ROGUES_CHEST_OPEN), "still open 33 ticks after the loot");
  tick(f);
  assert.ok(shownIds(object).includes(ROGUES_CHEST), `restocked 34 ticks after the loot (capture 462: 184 to 218): ${shownIds(object)}`);
});

test("the Rogues' chest uses the Hard table once the Hard diary is done, and for Elite completers", async (t) => {
  for (const tiers of [["medium", "hard"], ["medium", "elite"]]) {
    const f = actor(t, { thieving: 99 });
    for (const tier of tiers) completeTier(f, tier);
    t.mock.method(Math, "random", () => 0.001);
    await click(f, chestAt(t, ROGUES_CHEST, [WILD[0] + 1, WILD[1] + tiers.length * 2]), "Search for traps");
    ticks(f, 14);
    assert.equal(count(f, I.NATURE_RUNE), 50, `the Hard table's first row with ${tiers}`);
    t.mock.restoreAll();
  }
});

test("the Rogues' chest gives nothing below 84 Thieving, without the Medium diary, or free-to-play", async (t) => {
  const low = actor(t, { thieving: 83 });
  completeTier(low, "medium");
  await click(low, chestAt(t, ROGUES_CHEST), "Search for traps");
  ticks(low, 14);
  assert.equal(count(low, I.NATURE_RUNE), 0);
  assert.equal(credited(low, ROGUES_TASK), false);

  const noDiary = actor(t, { thieving: 99 });
  t.mock.method(Math, "random", () => 0.001);
  await click(noDiary, chestAt(t, ROGUES_CHEST, [WILD[0] + 1, WILD[1] + 2]), "Search for traps");
  ticks(noDiary, 14);
  assert.equal(count(noDiary, I.NATURE_RUNE), 0, "since 28 January 2026 the Wiki needs the Medium diary for any loot");
  assert.equal(credited(noDiary, ROGUES_TASK), false);
  t.mock.restoreAll();

  const free = actor(t, { thieving: 99 });
  completeTier(free, "medium");
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  await click(free, chestAt(t, ROGUES_CHEST, [WILD[0] + 1, WILD[1] + 4]), "Search for traps");
  ticks(free, 14);
  assert.equal(count(free, I.NATURE_RUNE), 0, "a free-to-play world has no Rogues' chest");
});

test("the Rogues' chest decides room before it rolls: one free slot starts nothing, two start it", async (t) => {
  const tight = actor(t, { thieving: 99 });
  completeTier(tight, "medium");
  fill(tight, 1);
  const object = chestAt(t, ROGUES_CHEST);
  const xp = tight.player.getSkillManager().getExperience(core.Skill.THIEVING);
  await click(tight, object, "Search for traps");
  ticks(tight, 14);
  assert.equal(textAt(tight, "You search the chest for traps."), undefined, "no sequence, so no free peek at the roll");
  assert.equal(tight.player.getSkillManager().getExperience(core.Skill.THIEVING), xp, "and no experience");
  assert.ok(shownIds(object).includes(ROGUES_CHEST), "the chest stays closed");

  const roomy = actor(t, { thieving: 99 });
  completeTier(roomy, "medium");
  fill(roomy, 2);
  t.mock.method(Math, "random", () => 0.001);
  await click(roomy, chestAt(t, ROGUES_CHEST, [WILD[0] + 1, WILD[1] + 2]), "Search for traps");
  ticks(roomy, 14);
  assert.equal(count(roomy, I.NATURE_RUNE), 40);
});

test("the Rogues' chest gives nothing when the room goes during the search, or the player walks off or dies", async (t) => {
  const cases = {
    "the inventory fills": (f) => fill(f, 0),
    "the player walks off": (f) => f.player.setLocation(new core.Location(WILD[0] - 3, WILD[1], 0)),
    "the player dies": (f) => f.player.setHitpoints(0),
  };
  let row = 0;
  for (const [label, interrupt] of Object.entries(cases)) {
    const f = actor(t, { thieving: 99 });
    completeTier(f, "medium");
    t.mock.method(Math, "random", () => 0.001);
    const object = chestAt(t, ROGUES_CHEST, [WILD[0] + 1, WILD[1] + 2 * (++row)]);
    f.player.setLocation(new core.Location(WILD[0], WILD[1] + 2 * row, 0));
    const xp = f.player.getSkillManager().getExperience(core.Skill.THIEVING);
    await click(f, object, "Search for traps");
    ticks(f, 2);
    interrupt(f);
    ticks(f, 14);
    assert.equal(count(f, I.NATURE_RUNE), 0, `nothing when ${label}`);
    assert.equal(f.player.getSkillManager().getExperience(core.Skill.THIEVING), xp, `no experience when ${label}`);
    assert.equal(credited(f, ROGUES_TASK), false, `no credit when ${label}`);
    assert.ok(shownIds(object).includes(ROGUES_CHEST), `the chest stays closed when ${label}`);
    t.mock.restoreAll();
  }
});

test("two players searching the same chest: the first to finish takes it, the second gets nothing", async (t) => {
  const first = actor(t, { thieving: 99 });
  const second = actor(t, { thieving: 99, at: [WILD[0] + 1, WILD[1] + 1] });
  completeTier(first, "medium");
  completeTier(second, "medium");
  t.mock.method(Math, "random", () => 0.001);
  const object = chestAt(t, ROGUES_CHEST, [WILD[0], WILD[1] + 1]);
  second.player.setLocation(new core.Location(WILD[0] + 1, WILD[1] + 1, 0));
  first.player.setLocation(new core.Location(WILD[0] - 1, WILD[1] + 1, 0));
  await click(first, object, "Search for traps");
  await click(second, object, "Search for traps");
  ticks(first, 14);
  assert.equal(count(first, I.NATURE_RUNE) + count(second, I.NATURE_RUNE), 40, "one player's loot, not two");
});

test("the plain Open option springs the trap: its message, animation, sound and a hit of 16 to 43", async (t) => {
  const f = actor(t, { thieving: 99 });
  const damage = [];
  const queue = f.player.getCombat().getHitQueue();
  const add = queue.addPendingDamage.bind(queue);
  queue.addPendingDamage = (hits) => { damage.push(...hits.map((hit) => hit.getDamage())); return add(hits); };
  const object = chestAt(t, ROGUES_CHEST);
  await click(f, object, "Open");
  ticks(f, 3);
  const at = textAt(f, "You have activated a trap on the chest.");
  assert.ok(at !== undefined, "the trap message");
  assert.deepEqual(f.animations.map(([n, id]) => [n - at, id]), [[0, 537]]);
  assert.deepEqual(f.sounds.map(([n, id, delay]) => [n - at, id, delay]), [[0, 2400, 0], [1, 518, 20]]);
  assert.equal(damage.length, 1);
  assert.ok(damage[0] >= 16 && damage[0] <= 43, `a hit of ${damage[0]}`);
  assert.equal(count(f, I.NATURE_RUNE), 0, "Open gives no loot");
  assert.ok(shownIds(object).includes(ROGUES_CHEST), "and the chest stays closed");
});

test("the Rogues' chest table is the Wiki's: 66 parts, the cut dragonstone, two diamond rows", () => {
  const Chests = require("../plugins/items/WildernessChests.plugin")._test;
  const table = Chests.roguesTable();
  assert.equal(table.reduce((sum, row) => sum + row[3], 0), 66, "rarities are out of 66");
  assert.equal(table.length, 18);
  assert.deepEqual(table.find((row) => row[0] === I.COINS).slice(1, 4), [4500, 5625, 6]);
  // The Wiki's row is "Dragonstone (noted)", worth 6,000 to alch: the cut gem, not the uncut one.
  const stone = table.find((row) => row[4] === "dragonstones");
  assert.equal(stone[0], noted(I.DRAGONSTONE));
  assert.notEqual(stone[0], noted(I.UNCUT_DRAGONSTONE));
  assert.equal(table.filter((row) => row[0] === noted(I.UNCUT_DIAMOND)).length, 2);
});

// Temple of Ikov: actual cache producers and decoded inputs, with supplied starts.
// Wiki quest oldid15363124 permits 1..5 arrows and consecutive same-chest stock.
// The older chest page's all-six-open advice differs; this tests the quest procedure.
// Logout events and area-exit relocation below are explicit lifecycle fixtures,
// not authenticated relog, natural dungeon traversal or OSRS stock-reset evidence.
const IKOV_CHESTS = [[2710, 9850], [2719, 9838], [2729, 9850], [2747, 9848], [2738, 9835], [2745, 9821]];
const ikovAt = object => [object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ()];
const ikovItems = player => structuredClone([player.getInventory(), player.getEquipment()].map(container =>
  container.getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() }))));
let ikovSerial = 0, ikovSetupDone = false, ikovSubmit, ikovWarn, ikovError, ikovLog;
const ikovTasks = new Set(), ikovErrors = [];
function ikovSetup() {
  if (ikovSetupDone) return;
  ikovSetupDone = true;
  ikovWarn = console.warn; ikovError = console.error; ikovLog = console.log;
  console.warn = (...args) => {
    if (/\[plugins\].*hook.*(?:threw|failed)/.test(args.map(String).join(' '))) ikovErrors.push(args.map(String).join(' '));
    ikovWarn(...args);
  };
  console.error = (...args) => { ikovErrors.push(args.map(String).join(' ')); ikovError(...args); };
  console.log = (...args) => {
    if (args.some(value => value instanceof Error)) ikovErrors.push(args.map(String).join(' '));
    ikovLog(...args);
  };
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  new NpcDefinitionLoader().load();
  ikovSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task, ...args) { ikovTasks.add(task); return ikovSubmit.call(this, task, ...args); };
  for (const tile of IKOV_CHESTS) core.RegionManager.loadMapFiles(...tile);
}
after(() => {
  if (!ikovSetupDone) return;
  try {
    for (const task of ikovTasks) if (task.isRunning()) task.stop();
    assert.deepEqual(ikovErrors, [], 'no swallowed Ikov plugin/engine errors');
  } finally {
    console.warn = ikovWarn; console.error = ikovError; console.log = ikovLog;
    core.TaskManager.submit = ikovSubmit;
  }
});
function ikovFixture(t) {
  ikovSetup();
  let worldTurn = 0;
  const fixtures = new Map(), tuples = new Map(), events = [];
  const regionChange = core.ObjectManager.onRegionChange;
  t.mock.method(core.ObjectManager, 'onRegionChange', function(...args) {
    // Capture actual PlayerSession scene tuples; replay never fabricates a base.
    tuples.set(args[0], args);
    return Reflect.apply(regionChange, this, args);
  });
  const emit = PM.emitObjectInteraction;
  t.mock.method(PM, 'emitObjectInteraction', function(event) {
    const result = Reflect.apply(emit, this, [event]);
    if (fixtures.has(event.player)) events.push(event);
    return result;
  });
  function turns(n = 1) {
    for (let turn = 0; turn < n; turn++) {
      worldTurn++;
      core.World.process();
      for (const { player } of fixtures.values()) {
        assert.equal(player.isRegistered(), true); assert.ok(player.getHitpoints() > 0);
        assert.equal(player.hasFlag('movement:ignore-clipping'), false);
        assert.equal(player.getPrivateArea(), null, 'ordinary shared dungeon, not a private-instance claim');
      }
    }
  }
  const base = index => {
    const [x, y] = IKOV_CHESTS[index];
    const object = core.MapObjects.get(103, new core.Location(x, y, 0), null);
    assert.ok(object, `actual closed cache chest103@${x},${y}`);
    assert.equal(object.getOwner(), null);
    assert.deepEqual(core.ObjectDefinition.forId(103).getInteractions().filter(Boolean), ['Open']);
    return object;
  };
  const opened = (f, index) => core.ObjectManager.objectsAt(base(index).getLocation())
    .find(object => object.getId() === 104 && object.getOwner() === f.player);
  function replay(f) {
    const tuple = tuples.get(f.player);
    assert.ok(tuple && tuple[0] === f.player, 'actual PlayerSession region tuple captured');
    const items = ikovItems(f.player), count = events.length, feedback = ikovFeedback(f);
    f.shown.length = 0; f.removed.length = 0;
    Reflect.apply(regionChange, core.ObjectManager, tuple);
    assert.deepEqual(ikovItems(f.player), items); assert.equal(events.length, count, 'scene replay performs no chest operation');
    assert.deepEqual(ikovFeedback(f), feedback, 'replay emits no loot feedback');
    assert.ok(f.shown.every(object => !object.getOwner() || object.getOwner() === f.player), 'no foreign owner loc replay');
  }
  function actor(index = 0, initialObject = null, startOnTrapLever = false) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), player = new Player(session), connection = new ClientConnection(channel);
    connection.player = player; session.setPlayer(player); session.setTurnPacketProcessor(() => connection.processTurnPackets());
    player.setUsername(`ikovchest${++ikovSerial}`); player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
    player.setAttribute('bot-skip-persistence', true);
    const f = { player, connection, shown: [], removed: [], shownAt: [], removedAt: [], boxes: [], boxItems: [], strings: [], sounds: [], typed: [], plain: [], overhead: [], animations: [] };
    fixtures.set(player, f);
    const forceChat = player.forceChat.bind(player), performAnimation = player.performAnimation.bind(player);
    player.forceChat = text => { f.overhead.push({ text, turn: worldTurn }); return forceChat(text); };
    player.performAnimation = animation => { f.animations.push({ id: animation.getId(), turn: worldTurn }); return performAnimation(animation); };
    const sender = player.getPacketSender(), sendObject = sender.sendObject.bind(sender), sendRemoval = sender.sendObjectRemoval.bind(sender);
    sender.sendObject = object => { f.shown.push(object); f.shownAt.push({ object, turn: worldTurn }); return sendObject(object); };
    sender.sendObjectRemoval = object => { f.removed.push(object); f.removedAt.push({ object, turn: worldTurn }); return sendRemoval(object); };
    for (const [method, rows] of [['sendChatboxInterface', f.boxes], ['sendItemOnInterfaces', f.boxItems],
      ['sendString', f.strings], ['sendSound', f.sounds], ['sendTypedMessage', f.typed], ['sendMessage', f.plain]]) {
      const original = sender[method].bind(sender);
      sender[method] = (...args) => { rows.push({ args, turn: worldTurn }); return original(...args); };
    }
    assert.equal(core.World.getPlayers().add(player), true);
    const ClimbLinks = require('../plugins/objects/ClimbLinks');
    const object = initialObject ?? base(index), at = object.getLocation();
    let stand;
    if (startOnTrapLever) {
      // Explicit initial fixture for real91 only: type4 reaches from its own
      // footprint. This is not a general fallback or an operation-time rescue.
      assert.ok(initialObject);
      assert.deepEqual([object.getId(), at.getX(), at.getY(), at.getZ(), object.getType(), object.getFace()],
        [91, 2665, 9855, 0, 4, 1]);
      assert.equal(object.getOwner(), null); assert.equal(object.getPrivateArea(), null);
      assert.equal(core.MapObjects.getPrivateArea(player, 91, at), object);
      const def = object.getDefinition();
      assert.equal(def.getSizeX(), 1); assert.equal(def.getSizeY(), 1);
      stand = at.clone();
      assert.equal(core.RegionManager.blocked(stand, null), false, 'supplied own-tile start is unblocked');
      const standIn = { getLocation: () => stand, getSize: () => 1, getPrivateArea: () => null };
      assert.equal(core.PathFinder.reachedObject(standIn, at.getX(), at.getY(), def.getSizeX(), def.getSizeY(),
        object.getFace(), object.getType(), def.getBlockingMask()), true, 'actual engine reaches91 from this footprint');
    } else {
      stand = ClimbLinks.landingTile(object, { x: at.getX(), y: at.getY() - 1 }, null);
      assert.ok(stand, 'cache geometry supplies initial adjacent stand');
    }
    player.moveTo(stand); // disclosed initial fixture only; operations never relocate to rescue a route
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'temple_of_ikov');
    assert.ok(quest); quest.setStage(player, 10);
    turns(4);
    assert.equal(player.isNeedsPlacement(), false);
    assert.equal(player.getArea()?.constructor.name, 'TempleOfIkovIceChests', 'real registered chest lifecycle area selected');
    assert.ok(tuples.has(player));
    t.after(() => {
      PM.emitPlayerLogout({ player, username: player.getUsername() });
      assert.ok([...ikovTasks].filter(task => task.key instanceof core.GameObject && task.key.getId() === 104 && task.key.getOwner() === player).every(task => !task.isRunning()), 'fixture logout stops all its chest timers');
      assert.ok(!core.ObjectManager.objectsAt(new core.Location(2671, 9804, 0)).some(object => object.getOwner() === player && [87, 88].includes(object.getId())), 'fixture logout removes its bracket overlay');
      assert.ok([...ikovTasks].filter(task => task.key?.player === player && task.key?.object?.getId?.() === 91)
        .every(task => !task.isRunning()), 'fixture logout stops every exact owner trap task');
      player.closeInterruptibleInterfaces(); player.getMovementQueue().reset(); player.getMovementQueue().walkToReset();
      const index = player.getIndex();
      core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(index);
      core.World.getPlayers().remove(player); fixtures.delete(player);
      assert.equal(player.isRegistered(), false);
      assert.equal(core.TaskManager.hasActiveTask(player), false); assert.equal(core.TaskManager.hasActiveTask(index), false);
    });
    return f;
  }
  async function operate(f, object, option, handled = true) {
    const actions = [...(core.CacheDefinitions.getObject(object.getId()).actions ?? [])], clickType = actions.indexOf(option) + 1;
    assert.ok(clickType > 0, `real cache ${object.getId()} option ${option}: ${JSON.stringify(actions)}`);
    const before = events.length, start = ikovAt(f.player), area = f.player.getArea(), items = ikovItems(f.player), trace = [];
    const at = object.getLocation();
    await f.connection.dispatch([{ type: 'object_option', id: object.getId(), x: at.getX(), y: at.getY(), clickType }]);
    for (let turn = 1; turn <= (handled ? 64 : 8); turn++) {
      turns();
      assert.equal(f.player.isNeedsPlacement(), false); assert.equal(f.player.getArea(), area);
      assert.equal(f.player.getLocation().getZ(), start[2]);
      if (!events.slice(before).some(event => event.player === f.player && event.object === object && event.handled === true)) {
        assert.deepEqual(ikovItems(f.player), items, 'walking to the operation grants or consumes no held items');
      }
      trace.push(ikovAt(f.player));
      if (events.slice(before).some(event => event.player === f.player && event.object === object && event.clickType === clickType && event.handled === true)) break;
    }
    const actual = events.slice(before).filter(event => event.player === f.player && event.object === object && event.clickType === clickType);
    if (handled) assert.ok(actual.some(event => event.handled === true && event.definition?.id === object.getId()), 'same real object handled after decoded input');
    else assert.equal(actual.length, 0, 'foreign owner loc is rejected before plugin dispatch');
    console.log('IKOV_CHEST_OPERATION', JSON.stringify({ username: f.player.getUsername(), object: object.getId(), at: ikovAt(object), option,
      start, end: ikovAt(f.player), turns: trace.length, trace, positiveDisplacement: trace.some(tile => tile.some((v, i) => v !== start[i])), handled }));
  }
  function shared(index, original, blocked) {
    assert.equal(base(index), original, 'shared cache producer never replaced or deregistered');
    assert.equal(core.RegionManager.blocked(original.getLocation(), null), blocked, 'shared clipping conserved');
    assert.ok(!core.World.getRemovedObjects().includes(original), 'shared base never enters removal replay');
  }
  function timer(object) {
    const tasks = [...ikovTasks].filter(task => task.key === object);
    assert.equal(tasks.length, 1, 'one actual scheduler task keyed to this opened object');
    return tasks[0];
  }
  return { actor, base, opened, operate, replay, turns, shared, timer, events, now: () => worldTurn };
}

function ikovFeedback(f) {
  const text = 'You found some ice arrows!';
  return {
    boxes: f.boxes.filter(row => row.args[0] === 193).length,
    items: f.boxItems.filter(row => row.args[0] === ((193 << 16) | 1) && row.args[1] === I.ICE_ARROWS).length,
    text: f.strings.filter(row => row.args[0] === text && row.args[1] === ((193 << 16) | 2)).length,
    mesbox: f.typed.filter(row => row.args[0] === core.ChatType.MESBOX && row.args[1] === text).length,
    extraPlain: f.plain.filter(row => row.args[0] === text).length
      + f.typed.filter(row => row.args[0] !== core.ChatType.MESBOX && row.args[1] === text).length,
    sound: f.sounds.filter(row => row.args[0] === 1628).length,
  };
}
function ikovFeedbackCount(f, count) {
  assert.deepEqual(ikovFeedback(f), { boxes: count, items: count, text: count, mesbox: count, extraPlain: 0, sound: count },
    'one real OBJECTBOX193/item/text/MESBOX and found-arrow sound per successful loot, no duplicate plain message');
}

test('Ikov real six cache chests support unforced stock search, owner isolation, replay and Shut restoration', async t => {
  const h = ikovFixture(t), a = h.actor(), b = h.actor();
  const originals = IKOV_CHESTS.map((_, index) => h.base(index));
  assert.equal(new Set(originals).size, 6);
  const actual = [...core.MapObjects.mapObjects.values()].flat().filter(object => object.getId() === 103
    && object.getLocation().getZ() === 0 && object.getLocation().getX() >= 2700 && object.getLocation().getX() <= 2753
    && object.getLocation().getY() >= 9815 && object.getLocation().getY() <= 9855);
  assert.deepEqual(actual.map(object => ikovAt(object)).sort(), IKOV_CHESTS.map(([x, y]) => [x, y, 0]).sort(), 'complete six actual cache producers in chest-room bounds');
  const original = originals[0], blocked = core.RegionManager.blocked(original.getLocation(), null);
  await h.operate(a, original, 'Open');
  const own = h.opened(a, 0); assert.ok(own); assert.equal(h.opened(b, 0), undefined);
  assert.equal(core.MapObjects.getPrivateArea(a.player, 104, own.getLocation()), own);
  const bItems = ikovItems(b.player);
  await h.operate(b, own, 'Search', false); assert.deepEqual(ikovItems(b.player), bItems); ikovFeedbackCount(b, 0);
  await h.operate(a, original, 'Open'); assert.equal(h.opened(a, 0), own, 'stale base Open does not reset stock or duplicate overlay');
  h.replay(a); assert.ok(a.shown.includes(own)); assert.ok(a.removed.includes(original));
  h.replay(b); assert.ok(!b.shown.includes(own)); assert.ok(!b.removed.includes(original));
  await h.operate(b, original, 'Open'); const other = h.opened(b, 0); assert.ok(other); assert.notEqual(other, own);
  h.replay(a); assert.ok(!a.shown.includes(other));
  // One ordinary unforced search per real chest, stopping at the single selected stock.
  for (let index = 0; index < 6 && a.player.getInventory().getAmount(I.ICE_ARROWS) === 0; index++) {
    if (!h.opened(a, index)) await h.operate(a, originals[index], 'Open');
    await h.operate(a, h.opened(a, index), 'Search');
    ikovFeedbackCount(a, a.player.getInventory().getAmount(I.ICE_ARROWS) > 0 ? 1 : 0);
  }
  const amount = a.player.getInventory().getAmount(I.ICE_ARROWS);
  assert.ok(amount >= 1 && amount <= 5, 'ordinary stock, not an injected arrow reward');
  assert.equal(b.player.getInventory().getAmount(I.ICE_ARROWS), 0);
  a.shown.length = 0;
  await h.operate(a, own, 'Shut'); assert.equal(h.opened(a, 0), undefined); assert.ok(a.shown.includes(original));
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(original));
  assert.equal(h.opened(b, 0), other); h.shared(0, original, blocked);
});

test('Ikov capacity refusal remembers sampled quantity across Shut and rerolls only after successful loot including same-chest reselection', async t => {
  const h = ikovFixture(t), f = h.actor(), limit = 2147483647;
  let selections = 0, samples = 0;
  const random = core.Misc.random;
  t.mock.method(core.Misc, 'random', function(min, max, ...args) {
    if (min === 0 && max === 5) { selections++; return 0; }
    if (min === 1 && max === 5) return ++samples === 1 ? 5 : 3;
    return Reflect.apply(random, this, [min, max, ...args]);
  });
  f.player.getInventory().adds(I.ICE_ARROWS, limit - 2); // explicit capacity/state fixture, no natural stock claim
  const before = ikovItems(f.player), base = h.base(0);
  await h.operate(f, base, 'Open'); await h.operate(f, h.opened(f, 0), 'Search');
  assert.deepEqual(ikovItems(f.player), before); assert.equal(selections, 1); assert.equal(samples, 1); ikovFeedbackCount(f, 0);
  h.replay(f); assert.equal(selections, 1); assert.equal(samples, 1);
  await h.operate(f, h.opened(f, 0), 'Shut'); await h.operate(f, base, 'Open');
  await h.operate(f, h.opened(f, 0), 'Search');
  assert.deepEqual(ikovItems(f.player), before); assert.equal(selections, 1); assert.equal(samples, 1); ikovFeedbackCount(f, 0);
  await h.operate(f, h.base(1), 'Open'); await h.operate(f, h.opened(f, 1), 'Search');
  assert.deepEqual(ikovItems(f.player), before); ikovFeedbackCount(f, 0);
  assert.equal(selections, 1); assert.equal(samples, 1, 'controlled wrong stock changes neither stored sample nor selection');
  await h.operate(f, h.opened(f, 1), 'Shut');
  f.player.getInventory().deleteNumber(I.ICE_ARROWS, 10);
  await h.operate(f, h.opened(f, 0), 'Search');
  assert.equal(f.player.getInventory().getAmount(I.ICE_ARROWS), limit - 7); assert.equal(samples, 1); assert.equal(selections, 2); ikovFeedbackCount(f, 1);
  await h.operate(f, h.opened(f, 0), 'Search');
  assert.equal(f.player.getInventory().getAmount(I.ICE_ARROWS), limit - 4); assert.equal(samples, 2); assert.equal(selections, 3); ikovFeedbackCount(f, 2);
});

test('Ikov explicit logout hook cleans only its owner and restores closed visibility before the next ordinary Open', async t => {
  const h = ikovFixture(t), a = h.actor(), b = h.actor(), base = h.base(0);
  await h.operate(a, base, 'Open'); await h.operate(b, base, 'Open');
  const own = h.opened(a, 0), other = h.opened(b, 0), items = ikovItems(a.player);
  a.shown.length = 0;
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() }); // explicit hook fixture, actor remains registered
  assert.equal(h.opened(a, 0), undefined); assert.equal(h.opened(b, 0), other); assert.ok(a.shown.includes(base));
  assert.equal(h.timer(own).isRunning(), false); assert.equal(h.timer(other).isRunning(), true);
  assert.equal(core.MapObjects.getPrivateArea(a.player, 104, base.getLocation()), null);
  assert.deepEqual(ikovItems(a.player), items);
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(base));
  h.replay(b); assert.ok(b.shown.includes(other));
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() }); // idempotent
  await h.operate(a, base, 'Open'); assert.ok(h.opened(a, 0)); assert.notEqual(h.opened(a, 0), own);
  assert.equal(h.timer(own).isRunning(), false); assert.equal(h.timer(h.opened(a, 0)).isRunning(), true);
  await h.operate(a, h.opened(a, 0), 'Search');
  const amount = a.player.getInventory().getAmount(I.ICE_ARROWS); assert.ok(amount >= 0 && amount <= 5);
});

test('Ikov actual AreaManager leave cleans its owner overlays and return replay allows a new ordinary Open', async t => {
  const h = ikovFixture(t), a = h.actor(), b = h.actor(), base = h.base(0);
  await h.operate(a, base, 'Open'); await h.operate(b, base, 'Open');
  const own = h.opened(a, 0), other = h.opened(b, 0), start = a.player.getLocation().clone(), area = a.player.getArea(), items = ikovItems(a.player);
  // Explicit lifecycle relocations, never fallback placement for a failed operation/route.
  a.player.moveTo(new core.Location(2649, 9805, 0)); h.turns(4);
  assert.equal(a.player.getArea(), area, 'staying elsewhere inside dungeon does not clear stock');
  assert.equal(h.opened(a, 0), own);
  a.player.moveTo(new core.Location(2664, 3420, 0)); h.turns(4);
  assert.notEqual(a.player.getArea(), area); assert.equal(h.opened(a, 0), undefined); assert.equal(h.opened(b, 0), other);
  assert.equal(h.timer(own).isRunning(), false); assert.equal(h.timer(other).isRunning(), true);
  assert.deepEqual(ikovItems(a.player), items);
  a.player.moveTo(start); h.turns(4);
  assert.equal(a.player.getArea(), area); assert.equal(a.player.isNeedsPlacement(), false);
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(base));
  h.replay(b); assert.ok(b.shown.includes(other));
  await h.operate(a, base, 'Open'); assert.ok(h.opened(a, 0)); assert.notEqual(h.opened(a, 0), own);
  assert.equal(h.timer(own).isRunning(), false); assert.equal(h.timer(h.opened(a, 0)).isRunning(), true);
  await h.operate(a, h.opened(a, 0), 'Search');
  const amount = a.player.getInventory().getAmount(I.ICE_ARROWS); assert.ok(amount >= 0 && amount <= 5);
});

test('Ikov owner overlay closes on its 300th actual World turn and keeps the selected sampled stock', async t => {
  const h = ikovFixture(t), a = h.actor(), b = h.actor(), base = h.base(0), limit = 2147483647;
  let selections = 0, samples = 0;
  const random = core.Misc.random;
  t.mock.method(core.Misc, 'random', function(min, max, ...args) {
    if (min === 0 && max === 5) { selections++; return 0; }
    if (min === 1 && max === 5) { samples++; return 5; }
    return Reflect.apply(random, this, [min, max, ...args]);
  });
  a.player.getInventory().adds(I.ICE_ARROWS, limit - 2); // explicit capacity fixture
  const items = ikovItems(a.player), blocked = core.RegionManager.blocked(base.getLocation(), null);
  await h.operate(a, base, 'Open'); const own = h.opened(a, 0), timer = h.timer(own);
  const openedTurn = a.shownAt.find(row => row.object === own).turn;
  await h.operate(a, own, 'Search'); ikovFeedbackCount(a, 0);
  await h.operate(b, base, 'Open'); const other = h.opened(b, 0);
  assert.equal(selections, 2); assert.equal(samples, 1);
  assert.ok(h.now() < openedTurn + 299);
  h.turns(openedTurn + 299 - h.now());
  assert.equal(h.opened(a, 0), own); assert.equal(timer.isRunning(), true);
  assert.deepEqual(ikovItems(a.player), items); ikovFeedbackCount(a, 0);
  h.turns();
  assert.equal(h.opened(a, 0), undefined); assert.equal(timer.isRunning(), false);
  const closedTurn = a.shownAt.find(row => row.object === base && row.turn > openedTurn).turn;
  assert.equal(closedTurn - openedTurn, 300, 'measured scheduler expiry, not just the authored delay constant');
  assert.equal(h.opened(b, 0), other, 'later owner overlay is unchanged at this owner deadline');
  assert.equal(h.timer(other).isRunning(), true);
  assert.deepEqual(ikovItems(a.player), items); ikovFeedbackCount(a, 0);
  assert.equal(selections, 2); assert.equal(samples, 1, 'timeout neither reselects nor resamples');
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(base)); h.shared(0, base, blocked);
  await h.operate(a, base, 'Open'); await h.operate(a, h.opened(a, 0), 'Search');
  assert.deepEqual(ikovItems(a.player), items); ikovFeedbackCount(a, 0);
  assert.equal(selections, 2); assert.equal(samples, 1);
  a.player.getInventory().deleteNumber(I.ICE_ARROWS, 10);
  await h.operate(a, h.opened(a, 0), 'Search');
  assert.equal(a.player.getInventory().getAmount(I.ICE_ARROWS), limit - 7);
  assert.equal(selections, 3); assert.equal(samples, 1); ikovFeedbackCount(a, 1);
  console.log('IKOV_CHEST_CLOSE_TIMING', JSON.stringify({ kind: 'capacity-timeout', openedTurn, closedTurn,
    elapsedTurns: closedTurn - openedTurn, sampleCallsAfterSuccess: samples, selectionsAfterSuccess: selections }));
});

test('Ikov Shut cancels only its overlay timer and a reopened chest survives the old deadline', async t => {
  const h = ikovFixture(t), f = h.actor(), base = h.base(0);
  let unrelatedCompleted = false;
  const unrelated = new core.CountdownTask(f.player, 900, () => { unrelatedCompleted = true; });
  core.TaskManager.submit(unrelated); t.after(() => unrelated.stop());
  await h.operate(f, base, 'Open'); const old = h.opened(f, 0), oldTimer = h.timer(old);
  const oldOpenedTurn = f.shownAt.find(row => row.object === old).turn;
  h.turns(100); await h.operate(f, old, 'Shut');
  assert.equal(oldTimer.isRunning(), false); assert.equal(unrelated.isRunning(), true);
  await h.operate(f, base, 'Open'); const replacement = h.opened(f, 0), newTimer = h.timer(replacement);
  assert.notEqual(replacement, old);
  const reopenedTurn = f.shownAt.find(row => row.object === replacement).turn;
  h.turns(oldOpenedTurn + 300 - h.now());
  assert.equal(h.opened(f, 0), replacement); assert.equal(newTimer.isRunning(), true);
  assert.ok(!f.shownAt.some(row => row.object === base && row.turn > reopenedTurn), 'old deadline never closes the replacement');
  h.turns(reopenedTurn + 299 - h.now()); assert.equal(h.opened(f, 0), replacement);
  h.turns(); assert.equal(h.opened(f, 0), undefined); assert.equal(newTimer.isRunning(), false);
  const closedTurn = f.shownAt.find(row => row.object === base && row.turn > reopenedTurn).turn;
  assert.equal(closedTurn - reopenedTurn, 300);
  assert.equal(unrelated.isRunning(), true); assert.equal(unrelatedCompleted, false);
  ikovFeedbackCount(f, 0); h.replay(f); assert.ok(!f.shown.includes(replacement)); assert.ok(!f.removed.includes(base));
  console.log('IKOV_CHEST_CLOSE_TIMING', JSON.stringify({ kind: 'shut-reopen', oldOpenedTurn, oldDeadlineTurn: oldOpenedTurn + 300,
    reopenedTurn, closedTurn, replacementElapsedTurns: closedTurn - reopenedTurn, oldTimerStopped: !oldTimer.isRunning(),
    unrelatedTimerStillRunning: unrelated.isRunning() }));
});

// Wiki Temple of Ikov oldid15363124: fit the recovered lever, then Pull to unlock
// the southern gate. Leaving before Pull loses the fitted lever. These tests use
// supplied stage10/items/starts and explicit lifecycle exits; no natural bridge,
// authenticated relog, recorded feedback or per-owner walking isolation claim.
const IKOV_BRACKET = [2671, 9804];
const IKOV_UNLOCK = 'temple-of-ikov:ice-gate-unlocked';
function ikovLeverFixture(t) {
  const h = ikovFixture(t);
  const base = core.MapObjects.get(86, new core.Location(...IKOV_BRACKET, 0), null);
  assert.ok(base, 'actual cache bracket86');
  assert.equal(base.getType(), 7); assert.equal(base.getFace(), 1);
  assert.equal(core.CacheDefinitions.getObject(86).name, 'Lever bracket');
  assert.deepEqual(core.CacheDefinitions.getObject(87).actions.filter(Boolean), ['Pull']);
  assert.equal(core.CacheDefinitions.getObject(88).actions.filter(Boolean).length, 0);
  const overlay = f => core.ObjectManager.objectsAt(base.getLocation()).find(o =>
    o.getOwner() === f.player && (o.getId() === 87 || o.getId() === 88));
  const actor = () => h.actor(0, base);
  async function use(f, itemId = I.LEVER, target = base) {
    const start = ikovAt(f.player), before = ikovItems(f.player), events = [], trace = [];
    const emit = PM.emitItemOnObject;
    const capture = t.mock.method(PM, 'emitItemOnObject', function(event) {
      const result = Reflect.apply(emit, this, [event]); events.push(event); return result;
    });
    try {
      await f.connection.dispatch([{ type: 'item_on_object', widgetId: core.Inventory.INTERFACE_ID,
        objectId: target.getId(), x: target.getLocation().getX(), y: target.getLocation().getY(), itemId,
        slot: f.player.getInventory().getSlotForItemId(itemId) }]);
      for (let turn = 0; turn < 32; turn++) {
        h.turns(); trace.push(ikovAt(f.player));
        if (events.some(e => e.player === f.player)) break;
        assert.deepEqual(ikovItems(f.player), before, 'approach consumes nothing');
      }
      assert.ok(events.some(e => e.player === f.player && e.object === target && e.itemId === itemId),
        'validated decoded item-on-object reaches actual shared bracket');
      console.log('IKOV_LEVER_USE', JSON.stringify({ itemId, start, end: ikovAt(f.player), trace,
        handled: events.at(-1).handled }));
      return events.at(-1);
    } finally { capture.mock.restore(); }
  }
  function shared() {
    assert.equal(core.MapObjects.get(86, base.getLocation(), null), base);
    assert.equal(base.getOwner(), null); assert.ok(!core.World.getRemovedObjects().includes(base));
  }
  return { ...h, base, actor, overlay, use, shared };
}

test('Ikov physical lever fits once as an owner-only Pull overlay without unlocking before Pull', async t => {
  const h = ikovLeverFixture(t), a = h.actor(), b = h.actor();
  const blocked = core.RegionManager.blocked(h.base.getLocation(), null);
  a.player.getInventory().adds(I.LEVER, 2); a.player.getInventory().adds(I.COINS, 17);
  const before = ikovItems(a.player);
  const event = await h.use(a);
  assert.equal(event.handled, true);
  assert.equal(a.player.getInventory().getAmount(I.LEVER), 1);
  assert.equal(a.player.getInventory().getAmount(I.COINS), 17);
  assert.notDeepEqual(ikovItems(a.player), before);
  const own = h.overlay(a); assert.equal(own.getId(), 87); assert.equal(own.getOwner(), a.player);
  assert.equal(h.overlay(b), undefined); assert.notEqual(a.player.getAttribute(IKOV_UNLOCK), 1);
  assert.equal(core.RegionManager.blocked(h.base.getLocation(), null), blocked); h.shared();
  const fitted = ikovItems(a.player);
  await h.use(a); assert.deepEqual(ikovItems(a.player), fitted); assert.equal(h.overlay(a), own);
  h.replay(a); assert.ok(a.shown.includes(own)); assert.ok(a.removed.includes(h.base));
  h.replay(b); assert.ok(!b.shown.includes(own)); assert.ok(!b.removed.includes(h.base));
  await h.operate(b, own, 'Pull', false);
  assert.notEqual(b.player.getAttribute(IKOV_UNLOCK), 1); assert.equal(h.overlay(a), own);
  await h.operate(a, own, 'Pull');
  assert.equal(a.player.getAttribute(IKOV_UNLOCK), 1); assert.equal(h.overlay(a).getId(), 88);
  assert.notEqual(h.overlay(a), own); assert.deepEqual(ikovItems(a.player), fitted); h.shared();
  // The old87 packet no longer resolves; it cannot re-pull or replace the current88.
  const lowered = h.overlay(a);
  await h.operate(a, own, 'Pull', false); assert.equal(h.overlay(a), lowered);
});

test('Ikov unpulled bracket is discarded on logout and area leave while another owner remains intact', async t => {
  const h = ikovLeverFixture(t), a = h.actor(), b = h.actor();
  a.player.getInventory().adds(I.LEVER, 2); b.player.getInventory().adds(I.LEVER, 1);
  await h.use(a); await h.use(b);
  const own = h.overlay(a), other = h.overlay(b), remaining = ikovItems(a.player);
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() });
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() });
  assert.equal(h.overlay(a), undefined); assert.equal(h.overlay(b), other);
  assert.deepEqual(ikovItems(a.player), remaining, 'no unpulled-lever refund');
  assert.notEqual(a.player.getAttribute(IKOV_UNLOCK), 1); h.shared();
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(h.base));
  await h.use(a); const replacement = h.overlay(a); assert.ok(replacement && replacement !== own);
  const start = a.player.getLocation().clone();
  a.player.moveTo(new core.Location(2664, 3420, 0)); h.turns(4); // explicit exit fixture
  assert.equal(h.overlay(a), undefined); assert.equal(h.overlay(b), other);
  a.player.moveTo(start); h.turns(4); // explicit return fixture
  assert.equal(h.overlay(a), undefined); assert.equal(a.player.getInventory().getAmount(I.LEVER), 0);
  assert.notEqual(a.player.getAttribute(IKOV_UNLOCK), 1); h.shared();
});

test('Ikov real southern gate refuses both leaves until Pull then opens through generic Doors and permits ordinary crossing', async t => {
  const h = ikovLeverFixture(t), a = h.actor(), b = h.actor();
  const gateBases = [[90, 2661], [89, 2662]].map(([id, x]) => {
    const object = core.MapObjects.get(id, new core.Location(x, 9803, 0), null);
    assert.ok(object, `actual gate${id}`); assert.equal(object.getType(), 0); assert.equal(object.getFace(), 3);
    return object;
  });
  const current = () => {
    const e = { objects: [...gateBases] }; PM.emitCustomEvent('door:state', e);
    // door:state describes poses using fresh snapshot objects. Decoded input
    // resolves registered instances; bind every pose back to that exact leaf.
    return e.objects.map(view => {
      const leaf = core.MapObjects.get(view.getId(), view.getLocation(), null);
      assert.ok(leaf, 'current gate pose has a registered shared-world leaf');
      assert.equal(leaf.getId(), view.getId()); assert.deepEqual(ikovAt(leaf), ikovAt(view));
      assert.equal(leaf.getType(), view.getType()); assert.equal(leaf.getFace(), view.getFace());
      assert.equal(leaf.getOwner(), null); assert.equal(leaf.getPrivateArea(), null);
      assert.equal(core.MapObjects.getPrivateArea(a.player, leaf.getId(), leaf.getLocation()), leaf);
      assert.equal(core.MapObjects.getPrivateArea(b.player, leaf.getId(), leaf.getLocation()), leaf);
      return leaf;
    });
  };
  const snapshot = objects => objects.map(o => [o.getId(), ...ikovAt(o), o.getType(), o.getFace()]);
  const closed = snapshot(gateBases);
  for (const gate of gateBases) {
    const items = ikovItems(a.player); await h.operate(a, gate, 'Open');
    assert.deepEqual(snapshot(current()), closed); assert.deepEqual(ikovItems(a.player), items);
    assert.ok(a.player.getLocation().getY() >= 9803, 'refusal has not crossed the closed gate');
  }
  a.player.getInventory().adds(I.LEVER, 1); await h.use(a);
  await h.operate(a, gateBases[1], 'Open'); assert.deepEqual(snapshot(current()), closed, 'fitting alone does not unlock');
  await h.operate(a, h.overlay(a), 'Pull');
  assert.equal(a.player.getAttribute(IKOV_UNLOCK), 1); assert.notEqual(b.player.getAttribute(IKOV_UNLOCK), 1);
  const items = ikovItems(a.player);
  await h.operate(a, gateBases[1], 'Open');
  let operationFailure;
  try {
    const opened = current(); assert.notDeepEqual(snapshot(opened), closed, 'real generic pair has swung open');
    assert.deepEqual(opened.map(o => o.getId()).sort(), [89, 90]);
    assert.ok(opened.every(o => o.getLocation().getY() === 9802), 'generic open pose matches scoped guard');
    await h.operate(b, opened[0], 'Open');
    assert.deepEqual(snapshot(current()), snapshot(opened), 'locked bystander click cannot toggle an open shared gate');
    const trace = [];
    await a.connection.dispatch([{ type: 'move', worldX: 2662, worldY: 9801, modifierFlags: 0, run: false }]);
    for (let turn = 0; turn < 24; turn++) { h.turns(); trace.push(ikovAt(a.player)); }
    assert.deepEqual(ikovAt(a.player), [2662, 9801, 0], 'ordinary clipped walk reaches the southern side');
    assert.deepEqual(ikovItems(a.player), items);
    console.log('IKOV_GATE_CROSSING', JSON.stringify({ closed, opened: snapshot(opened), trace,
      bystanderUnlock: b.player.getAttribute(IKOV_UNLOCK) ?? 0, sharedWorldGate: true }));
  } catch (error) {
    operationFailure = error;
    throw error;
  } finally {
    try {
      // Re-read both the current pose and registered identity after the body:
      // an auto-close may already have restored new closed-leaf instances.
      const open = current();
      if (JSON.stringify(snapshot(open)) !== JSON.stringify(closed)) await h.operate(a, open[0], 'Open');
      assert.deepEqual(snapshot(current()), closed, 'generic gate restored for subsequent fixtures');
    } catch (cleanupError) {
      if (!operationFailure) throw cleanupError;
      console.error('IKOV_GATE_RESTORATION_FAILED_AFTER_PRIMARY', cleanupError);
    }
  }
  const start = a.player.getLocation().clone(), lower = h.overlay(a);
  a.player.moveTo(new core.Location(2664, 3420, 0)); h.turns(4);
  assert.equal(h.overlay(a), undefined); assert.equal(a.player.getAttribute(IKOV_UNLOCK), 1);
  a.player.moveTo(start); h.turns(4);
  assert.equal(h.overlay(a).getId(), 88); assert.notEqual(h.overlay(a), lower);
  h.replay(a); assert.ok(a.shown.includes(h.overlay(a))); h.shared();
});

test('Ikov named hooks leave unrelated Lever Pull and matching-name out-of-scope item use unclaimed', async t => {
  const h = ikovLeverFixture(t), a = h.actor();
  // Explicit dynamic fixtures reuse actual cache definitions at another placement;
  // they check named-wrapper fallthrough, not another natural quest producer.
  const wrongAt = new core.Location(2672, 9805, 0);
  const unrelated = new core.GameObject(87, wrongAt, 7, 1, null);
  const bracket = new core.GameObject(86, wrongAt.clone(), 7, 1, null);
  a.player.getInventory().adds(I.LEVER, 1); a.player.getInventory().adds(I.COINS, 1);
  const items = ikovItems(a.player);
  core.ObjectManager.register(unrelated, true);
  try {
    const n = h.events.length;
    await a.connection.dispatch([{ type: 'object_option', id: 87, x: 2672, y: 9805, clickType: 1 }]);
    h.turns(12);
    const e = h.events.slice(n).find(e => e.player === a.player && e.object === unrelated);
    assert.ok(e, 'real named Lever/Pull wrapper invoked from decoded action');
    assert.notEqual(e.handled, true, 'out-of-scope callback returns false through named wrapper');
    assert.deepEqual(ikovItems(a.player), items); assert.equal(h.overlay(a), undefined);
  } finally { core.ObjectManager.deregister(unrelated, true); }
  core.ObjectManager.register(bracket, true);
  try {
    assert.equal((await h.use(a, I.LEVER, bracket)).handled, false,
      'matching item and object names at wrong tile remain unclaimed');
    assert.equal((await h.use(a, I.COINS)).handled, false, 'unrelated held item remains unclaimed');
    assert.deepEqual(ikovItems(a.player), items); assert.equal(h.overlay(a), undefined); h.shared();
  } finally { core.ObjectManager.deregister(bracket, true); }
});

// Trapped lever: Wiki quest15363124 supplies current42 Search, safe Pull and
// western-door unlock; retained Wiki transcript supplies tbox text/fall20/Ouch.
// The pit101-to-southern100 transport is an authored content geometry model;
// adjacent stands come from the real cache, not a claimed retail falling tile.
// Stage10/items/skill levels/HP/starts and explicit lifecycle exits are fixtures.
const IKOV_TRAP_DISARMED = 'temple-of-ikov:trap-disarmed';
const IKOV_TRAP_UNLOCKED = 'temple-of-ikov:trap-door-unlocked';
const trapFlag = (f, key) => f.player.getAttribute(key) ?? 0;
function ikovTrapFixture(t) {
  const h = ikovFixture(t);
  function object(id, x, y, type, face) {
    const value = core.MapObjects.get(id, new core.Location(x, y, 0), null);
    assert.ok(value, `actual trap cache object${id}@${x},${y}`);
    assert.equal(value.getType(), type); assert.equal(value.getFace(), face);
    assert.equal(value.getPrivateArea(), null); assert.equal(value.getOwner(), null);
    return value;
  }
  const lever = object(91, 2665, 9855, 4, 1), door = object(92, 2648, 9857, 0, 1);
  const ladder = object(101, 2682, 9849, 10, 2), exit = object(100, 2665, 9849, 22, 3);
  object(100, 2665, 9855, 22, 3);
  assert.equal(core.CacheDefinitions.getLocId('ikov_traplever'), 91);
  assert.equal(core.CacheDefinitions.getLocId('ikov_trapleverdoor'), 92);
  assert.equal(core.CacheDefinitions.getLocId('ikov_trapladder'), 101);
  assert.deepEqual(core.CacheDefinitions.getObject(91).actions.filter(Boolean), ['Pull', 'Search for traps']);
  assert.deepEqual(core.CacheDefinitions.getObject(101).actions.filter(Boolean), ['Climb-up']);
  assert.ok(Number.isInteger(core.CacheDefinitions.getSeqId('macro_lever_switch_down')));
  function actor(level = 42) {
    const f = h.actor(0, lever, true), skills = f.player.getSkillManager();
    skills.setMaxLevels(core.Skill.THIEVING, level, false).setCurrentLevels(core.Skill.THIEVING, level, false);
    skills.setMaxLevels(core.Skill.HITPOINTS, 60, false).setCurrentLevels(core.Skill.HITPOINTS, 60, false);
    f.player.setHitpoints(60); f.player.getInventory().adds(I.COINS, 23);
    return f;
  }
  function currentDoor(...actors) {
    const request = { objects: [door] }; PM.emitCustomEvent('door:state', request);
    assert.equal(request.objects.length, 1, 'one generic western door leaf');
    const view = request.objects[0], live = core.MapObjects.get(view.getId(), view.getLocation(), null);
    assert.ok(live, 'door pose resolves actual registered leaf');
    assert.deepEqual([live.getId(), ...ikovAt(live), live.getType(), live.getFace()],
      [view.getId(), ...ikovAt(view), view.getType(), view.getFace()]);
    assert.equal(live.getOwner(), null); assert.equal(live.getPrivateArea(), null);
    for (const f of actors) assert.equal(core.MapObjects.getPrivateArea(f.player, live.getId(), live.getLocation()), live);
    return live;
  }
  const pose = o => [o.getId(), ...ikovAt(o), o.getType(), o.getFace()];
  const tasks = f => [...ikovTasks].filter(task => task.key?.player === f.player && task.key?.object === lever);
  function shared() {
    assert.equal(core.MapObjects.get(91, lever.getLocation(), null), lever);
    assert.equal(core.MapObjects.get(101, ladder.getLocation(), null), ladder);
    assert.equal(core.MapObjects.get(100, exit.getLocation(), null), exit);
    for (const base of [lever, ladder, exit]) assert.ok(!core.World.getRemovedObjects().includes(base));
  }
  function statementCount(f, text) {
    return f.strings.filter(row => row.args[0] === text && row.args[1] === ((229 << 16) | 3)).length;
  }
  const pullPacket = () => ({ type: 'object_option', id: 91, x: 2665, y: 9855,
    clickType: core.CacheDefinitions.getObject(91).actions.indexOf('Pull') + 1 });
  return { ...h, lever, door, ladder, exit, actor, currentDoor, pose, tasks, shared, statementCount, pullPacket };
}

test('Ikov trapped lever Search uses current boosted42 with no XP and only safe Pull unlocks the western door', async t => {
  const h = ikovTrapFixture(t), a = h.actor(41), b = h.actor(41), closed = h.pose(h.door);
  const crosses = () => core.RegionManager.canMove(2648, 9857, 2648, 9858, 0, 1, 1, null);
  assert.equal(crosses(), false, 'closed western door blocks its actual north edge');
  const items = ikovItems(a.player), xp = a.player.getSkillManager().getExperience(core.Skill.THIEVING);
  await h.operate(a, h.door, 'Open'); assert.deepEqual(h.pose(h.currentDoor(a, b)), closed);
  await h.operate(a, h.lever, 'Search for traps');
  assert.equal(trapFlag(a, IKOV_TRAP_DISARMED), 0); assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
  assert.equal(h.statementCount(a, 'You find nothing.'), 1); assert.ok(a.boxes.some(row => row.args[0] === 229));
  assert.equal(a.player.getHitpoints(), 60); assert.deepEqual(ikovItems(a.player), items);
  a.player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 42, false); // explicit +1 boost fixture
  assert.equal(a.player.getSkillManager().getMaxLevel(core.Skill.THIEVING), 41);
  await h.operate(a, h.lever, 'Search for traps');
  assert.equal(trapFlag(a, IKOV_TRAP_DISARMED), 1); assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
  assert.equal(h.statementCount(a, 'You find a trap on the lever! You disable the trap.'), 1);
  assert.equal(a.player.getSkillManager().getExperience(core.Skill.THIEVING), xp);
  await h.operate(a, h.door, 'Open'); assert.deepEqual(h.pose(h.currentDoor(a, b)), closed, 'Search alone does not unlock');
  await h.operate(a, h.lever, 'Pull'); h.turns(3);
  assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 1); assert.equal(a.player.getHitpoints(), 60);
  assert.ok(a.animations.some(row => row.id === core.CacheDefinitions.getSeqId('macro_lever_switch_down')));
  assert.equal(trapFlag(b, IKOV_TRAP_UNLOCKED), 0); assert.equal(trapFlag(b, IKOV_TRAP_DISARMED), 0);
  assert.ok(h.tasks(a).every(task => !task.isRunning())); assert.equal(a.player.getMovementQueue().isMovementBlocked(), false);
  await h.operate(a, h.currentDoor(a, b), 'Open');
  let primary;
  try {
    const open = h.currentDoor(a, b); assert.notDeepEqual(h.pose(open), closed);
    assert.equal(open.getId(), 92); assert.deepEqual(ikovAt(open), [2648, 9858, 0]); assert.equal(open.getFace(), 2);
    assert.equal(crosses(), true, 'real catalog opening removes the doorway edge clipping');
    await h.operate(b, open, 'Open'); assert.deepEqual(h.pose(h.currentDoor(a, b)), h.pose(open), 'locked bystander cannot toggle shared opened door');
    const trace = [];
    await a.connection.dispatch([{ type: 'move', worldX: 2648, worldY: 9860, modifierFlags: 0, run: false }]);
    for (let turn = 0; turn < 32; turn++) { h.turns(); trace.push(ikovAt(a.player)); }
    assert.deepEqual(ikovAt(a.player), [2648, 9860, 0], 'ordinary clipped walk enters the western room');
    assert.deepEqual(ikovItems(a.player), items); assert.equal(a.player.getHitpoints(), 60);
    console.log('IKOV_TRAP_DOOR_ROUTE', JSON.stringify({ closed, open: h.pose(open), trace, authoredRouteModel: true }));
  } catch (error) { primary = error; throw error; }
  finally {
    try {
      const live = h.currentDoor(a, b);
      if (JSON.stringify(h.pose(live)) !== JSON.stringify(closed)) await h.operate(a, live, 'Open');
      assert.deepEqual(h.pose(h.currentDoor(a, b)), closed);
      assert.equal(crosses(), false, 'retoggle restores the closed door clipping');
    } catch (error) { if (!primary) throw error; console.error('IKOV_TRAP_DOOR_CLEANUP_FAILED_AFTER_PRIMARY', error); }
  }
  assert.deepEqual(ikovItems(a.player), items); assert.equal(a.player.getSkillManager().getExperience(core.Skill.THIEVING), xp); h.shared();
});

test('Ikov unsearched Pull applies20 once in the cache-derived pit and actual101 climb returns without unlocking', async t => {
  const h = ikovTrapFixture(t), a = h.actor(41), b = h.actor(41);
  const items = ikovItems(a.player), start = ikovAt(a.player), area = a.player.getArea(), closed = h.pose(h.door);
  await h.operate(a, h.lever, 'Pull'); h.turns(3);
  const pit = ikovAt(a.player), at = h.ladder.getLocation(), def = h.ladder.getDefinition();
  assert.notDeepEqual(pit, start); assert.equal(a.player.getArea(), area);
  assert.equal(core.RegionManager.blocked(a.player.getLocation(), null), false);
  assert.equal(core.PathFinder.reachedObject(a.player, at.getX(), at.getY(), def.getSizeX(), def.getSizeY(),
    h.ladder.getFace(), h.ladder.getType(), def.getBlockingMask()), true, 'real pit stand can operate the real ladder');
  assert.equal(a.player.getHitpoints(), 40, 'one physical20 hit lands through native HitQueue');
  assert.equal(a.overhead.filter(row => row.text === 'Ouch!').length, 1);
  assert.equal(trapFlag(a, IKOV_TRAP_DISARMED), 0); assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
  assert.equal(b.player.getHitpoints(), 60); assert.deepEqual(h.pose(h.currentDoor(a, b)), closed);
  h.turns(3); assert.equal(a.player.getHitpoints(), 40); assert.deepEqual(ikovItems(a.player), items);
  assert.ok(h.tasks(a).every(task => !task.isRunning())); assert.equal(a.player.getMovementQueue().isMovementBlocked(), false);
  await h.operate(a, h.ladder, 'Climb-up'); h.turns(4);
  const returned = ikovAt(a.player), exitAt = h.exit.getLocation(), exitDef = h.exit.getDefinition();
  assert.notDeepEqual(returned, pit); assert.equal(a.player.getArea(), area); assert.equal(a.player.isNeedsPlacement(), false);
  assert.equal(core.RegionManager.blocked(a.player.getLocation(), null), false);
  assert.equal(core.PathFinder.reachedObject(a.player, exitAt.getX(), exitAt.getY(), exitDef.getSizeX(), exitDef.getSizeY(),
    h.exit.getFace(), h.exit.getType(), exitDef.getBlockingMask()), true, 'return stand reaches actual southern trapdoor');
  assert.equal(a.player.getHitpoints(), 40); assert.deepEqual(ikovItems(a.player), items);
  assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
  a.player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 42, false);
  await h.operate(a, h.lever, 'Search for traps'); // ordinary approach after actual101 return; no rescue placement
  assert.equal(trapFlag(a, IKOV_TRAP_DISARMED), 1); assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
  console.log('IKOV_TRAP_PIT_ROUTE', JSON.stringify({ start, pit, returned, hp: a.player.getHitpoints(),
    authoredAssociation: 'pit101-to-southern100', exactRetailLandingClaimed: false })); h.shared();
});

test('Ikov pending trap Pull cancels exactly on logout and area exit while other-owner and unrelated tasks survive', async t => {
  const h = ikovTrapFixture(t), a = h.actor(41), b = h.actor(41), aStart = ikovAt(a.player), aItems = ikovItems(a.player);
  let unrelatedFired = false;
  const unrelated = new core.CountdownTask({ unrelated: true }, 900, () => { unrelatedFired = true; });
  core.TaskManager.submit(unrelated); t.after(() => unrelated.stop());
  await Promise.all([a.connection.dispatch([h.pullPacket()]), b.connection.dispatch([h.pullPacket()])]);
  h.turns();
  const aTask = h.tasks(a).at(-1), bTask = h.tasks(b).at(-1);
  assert.ok(aTask?.isRunning() && bTask?.isRunning(), 'both actual decoded actor Pulls are pending before next task turn');
  assert.notEqual(aTask, bTask); assert.notEqual(aTask.key, bTask.key);
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() }); // explicit hook fixture, actor remains registered
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() });
  assert.equal(aTask.isRunning(), false); assert.equal(bTask.isRunning(), true);
  assert.equal(a.player.getMovementQueue().isMovementBlocked(), false);
  h.turns(3);
  assert.deepEqual(ikovAt(a.player), aStart); assert.equal(a.player.getHitpoints(), 60);
  assert.equal(b.player.getHitpoints(), 40); assert.equal(bTask.isRunning(), false);
  assert.equal(unrelated.isRunning(), true); assert.equal(unrelatedFired, false); assert.deepEqual(ikovItems(a.player), aItems);
  await h.operate(a, h.lever, 'Pull');
  const replacement = h.tasks(a).at(-1); assert.ok(replacement.isRunning()); assert.notEqual(replacement, aTask);
  a.player.moveTo(new core.Location(2664, 3420, 0)); h.turns(3); // explicit lifecycle exit, not operation fallback
  assert.equal(replacement.isRunning(), false); assert.equal(a.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(a.player.getHitpoints(), 60); assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
  a.player.moveTo(new core.Location(...aStart)); h.turns(4); // explicit lifecycle return
  assert.equal(a.player.getHitpoints(), 60); assert.deepEqual(ikovItems(a.player), aItems);
  assert.equal(unrelated.isRunning(), true); assert.equal(unrelatedFired, false); h.shared();
});

test('Ikov trap named Search and Pull leave matching-name wrong-placement lever actions unclaimed', async t => {
  const h = ikovTrapFixture(t), a = h.actor(42), items = ikovItems(a.player);
  const wrong = new core.GameObject(91, new core.Location(2666, 9854, 0), 4, 1, null);
  core.ObjectManager.register(wrong, true);
  try {
    for (const option of ['Search for traps', 'Pull']) {
      const before = h.events.length, at = wrong.getLocation();
      await a.connection.dispatch([{ type: 'object_option', id: 91, x: at.getX(), y: at.getY(),
        clickType: core.CacheDefinitions.getObject(91).actions.indexOf(option) + 1 }]);
      h.turns(16);
      const event = h.events.slice(before).find(event => event.player === a.player && event.object === wrong);
      assert.ok(event, 'real decoded named wrapper reached the disclosed wrong-placement fixture');
      assert.notEqual(event.handled, true, 'out-of-scope named callback returns false');
      assert.equal(trapFlag(a, IKOV_TRAP_DISARMED), 0); assert.equal(trapFlag(a, IKOV_TRAP_UNLOCKED), 0);
      assert.equal(a.player.getHitpoints(), 60); assert.equal(h.tasks(a).length, 0); assert.deepEqual(ikovItems(a.player), items);
    }
    assert.equal(h.statementCount(a, 'You find a trap on the lever! You disable the trap.'), 0); h.shared();
  } finally { core.ObjectManager.deregister(wrong, true); }
});
