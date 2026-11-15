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
  function actor(index = 0, initialObject = null, startOnTrapLever = false, initial = {}) {
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
    if (initial.stand) {
      // Supplied, independently cache-checked bridge bank. Never used after input.
      stand = initial.stand.clone();
      assert.equal(core.RegionManager.blocked(stand, null), false, 'initial bank is unblocked');
    } else if (startOnTrapLever) {
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
    if (initial.hitpoints != null) {
      player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, initial.hitpoints);
      player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, initial.hitpoints, false);
      player.setHitpoints(initial.hitpoints);
    }
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
  // Rsprox rev 242 recording 912156: ikov_leverdown t539, mesbox t543 (four turns later), once.
  const machinery = 'You hear the clunking of some hidden machinery.';
  const mesbox = () => a.typed.filter(row => row.args[0] === core.ChatType.MESBOX && row.args[1] === machinery);
  const lowered88 = a.shownAt.find(row => row.object === h.overlay(a)).turn;
  assert.equal(mesbox().length, 0, 'no message on the pull turn'); assert.equal(b.typed.filter(row => row.args[1] === machinery).length, 0);
  h.turns(3); assert.equal(mesbox().length, 0, 'not before the recorded delay');
  h.turns(1); assert.equal(mesbox().length, 1); assert.equal(mesbox()[0].turn - lowered88, 4);
  h.turns(3); assert.equal(mesbox().length, 1, 'sent once');
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

const IKOV_WARRIOR_DEFEATED = 'temple-of-ikov:fire-warrior-defeated';
function ikovWarriorFixture(t) {
  const h = ikovFixture(t);
  core.RegionManager.loadMapFiles(2646, 9870);
  const at = new core.Location(2646, 9870, 0), door = core.MapObjects.get(93, at, null);
  assert.ok(door, 'real cache fire-warrior door93 is present');
  assert.deepEqual([door.getId(), ...ikovAt(door), door.getType(), door.getFace()], [93, 2646, 9870, 0, 0, 1]);
  assert.equal(door.getOwner(), null); assert.equal(door.getPrivateArea(), null);
  assert.ok(core.CacheDefinitions.getObject(93).actions.includes('Open'));
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'temple_of_ikov');
  const fixtures = [], speech = [], views = [];
  const forceChat = core.NPC.prototype.forceChat;
  t.mock.method(core.NPC.prototype, 'forceChat', function(text) {
    if (this.getId() === 3448 && fixtures.some(f => this.getOwner() === f.player)) speech.push({ npc: this, text, turn: h.now() });
    return Reflect.apply(forceChat, this, [text]);
  });
  function actor() {
    const f = h.actor(0, door); fixtures.push(f);
    const skills = f.player.getSkillManager();
    skills.setMaxLevel(core.Skill.HITPOINTS, 99); skills.setCurrentLevel(core.Skill.HITPOINTS, 99, false);
    f.player.setHitpoints(99);
    assert.equal(quest.getStage(f.player), 10, 'natural started fixture has not paid Winelda');
    assert.equal(f.player.getAttribute(IKOV_WARRIOR_DEFEATED) ?? 0, 0);
    assert.ok(f.player.getLocation().getY() <= 9870, 'cache-derived initial stand is on the entry side');
    assert.equal(core.MapObjects.getPrivateArea(f.player, 93, at), door);
    const session = f.player.getSession(), create = session.createActorUpdates;
    t.mock.method(session, 'createActorUpdates', function(npc, ...args) {
      const result = Reflect.apply(create, this, [npc, ...args]);
      if (npc.getId?.() === 3448 && npc.getOwner?.() === f.player && result.forcedChat !== undefined)
        views.push({ player: f.player, npc, text: result.forcedChat });
      return result;
    });
    return f;
  }
  function own(f) {
    const npcs = [];
    core.World.getNpcs().forEach(npc => { if (npc.getId() === 3448 && npc.getOwner() === f.player) npcs.push(npc); });
    assert.ok(npcs.length <= 1, 'at most one actual encounter NPC per owner');
    return npcs[0];
  }
  const crosses = () => core.RegionManager.canMovestart(new core.Location(2646, 9870, 0), new core.Location(2646, 9871, 0), 1, 1, null);
  function closed() {
    const current = core.MapObjects.get(93, at, null);
    assert.ok(current, 'restored actual door93');
    assert.deepEqual([current.getType(), current.getFace(), ...ikovAt(current)], [0, 1, 2646, 9870, 0]);
    assert.equal(crosses(), false, 'shared closed wall clips ordinary crossing');
    for (const f of fixtures) assert.equal(core.MapObjects.getPrivateArea(f.player, 93, at), current);
    return current;
  }
  async function lethalOwnedQueue(f, npc) {
    // Controlled lethal native hit, not a naturally won combat or accuracy assertion.
    const deaths = [], emit = PM.emitNpcDeath;
    t.mock.method(PM, 'emitNpcDeath', function(event) { deaths.push(event); return Reflect.apply(emit, this, [event]); });
    const hp = npc.getHitpoints(); assert.ok(hp > 0);
    const hit = new core.PendingHit(f.player, npc, core.CombatFactory.getMethod(f.player),
      { statusDamage: true, damage: hp, handleAfterHitEffects: false });
    core.CombatFactory.addPendingHit(hit);
    for (let turn = 0; turn < 24 && !deaths.some(e => e.npc === npc); turn++) h.turns();
    assert.ok(deaths.some(e => e.npc === npc && e.killer === f.player), 'real queue/death task emits the actual owned NPC');
  }
  t.after(() => {
    // A failed assertion may leave the two-tick shared gate close pending.
    // Drain its existing anchor-owned task even when actor assertions failed;
    // do not fabricate a replacement door or reset the plugin's gate state.
    for (let turn = 0; turn < 4; turn++) core.TaskManager.process();
    closed();
  });
  return { ...h, door, quest, actor, own, speech, views, crosses, closed, lethalOwnedQueue };
}

test('Ikov first door encounter keeps93 closed through both owned overheads and entry-side retreat before a real pre-Winelda death', async t => {
  const h = ikovWarriorFixture(t), a = h.actor(), b = h.actor(), items = ikovItems(a.player);
  h.closed();
  await h.operate(a, h.door, 'Open');
  const npc = h.own(a); assert.ok(npc); assert.equal(npc.isOwnerOnly(), true);
  const encounterStart = ikovAt(a.player);
  assert.equal(h.crosses(), false, 'the first click does not remove the shared wall');
  h.turns(12);
  assert.deepEqual(h.speech.filter(row => row.npc === npc).map(row => row.text), ['You will not pass!', 'Amitus! Setitii!']);
  assert.deepEqual(h.views.filter(row => row.player === a.player && row.npc === npc).map(row => row.text),
    ['You will not pass!', 'Amitus! Setitii!'], 'actual session actor views carry both overheads; not rendered/network delivery proof');
  assert.equal(h.speech.some(row => row.npc.getOwner() === b.player), false);
  assert.deepEqual(ikovAt(a.player), [encounterStart[0], encounterStart[1] - 1, encounterStart[2]],
    'full transcript executes one actual authored retreat on the entry side');
  assert.ok(a.player.getLocation().getY() <= 9870, 'full transcript action cannot place the entrant north through the wall');
  for (const f of [a, b]) {
    assert.equal(f.plain.some(row => row.args.some(value => typeof value === 'string' && /You will not pass!|Amitus! Setitii!/.test(value))), false,
      'no chatbox fallback for owned overheads');
    await f.connection.dispatch([{ type: 'move', worldX: 2646, worldY: 9873, modifierFlags: 0, run: false }]);
    h.turns(12); assert.ok(f.player.getLocation().getY() <= 9870, 'ordinary unauthorized crossing remains physically clipped');
  }
  assert.equal(h.quest.getStage(a.player), 10); assert.deepEqual(ikovItems(a.player), items);
  await h.lethalOwnedQueue(a, npc);
  assert.equal(a.player.getAttribute(IKOV_WARRIOR_DEFEATED), 1);
  assert.equal(h.quest.getStage(a.player), 10, 'owned death records defeat without jumping past Winelda');
  assert.equal(b.player.getAttribute(IKOV_WARRIOR_DEFEATED) ?? 0, 0);
  h.turns(4);
  await h.operate(a, h.closed(), 'Open');
  const force = a.player.getForceMovement(); assert.ok(force, 'authorized passage is explicit controlled force movement');
  assert.equal(h.crosses(), false, 'shared open passage retains its real blocker');
  const opened = core.MapObjects.getPrivateArea(b.player, 93, new core.Location(2646, 9871, 0));
  assert.ok(opened); assert.deepEqual([opened.getType(), opened.getFace()], [0, 2]);
  await b.connection.dispatch([{ type: 'object_option', id: 93, x: 2646, y: 9871, clickType: 1 }]);
  h.turns(); assert.ok(b.player.getForceMovement() == null, 'unqualified open-pose click does not authorize carry');
  assert.equal(a.player.getLocation().getY(), 9871, 'explicit authored one-tile carry crosses the exact adjacent edge');
  h.turns(3); h.closed();
  assert.equal(h.own(a), undefined, 'defeated encounter does not respawn');
  assert.deepEqual(ikovItems(a.player), items); assert.equal(a.player.hasFlag('movement:ignore-clipping'), false);
});

test('Ikov encounter readiness cancels on owner relocation and logout without a foreign speaker or shared-wall removal', async t => {
  const h = ikovWarriorFixture(t), a = h.actor(), b = h.actor();
  await h.operate(a, h.door, 'Open'); const own = h.own(a); assert.ok(own);
  a.player.moveTo(new core.Location(2664, 3420, 0)); // disclosed lifecycle exit before first readiness task
  h.turns(10);
  assert.equal(h.speech.some(row => row.npc === own), false); assert.deepEqual(ikovAt(a.player), [2664, 3420, 0]);
  h.closed(); assert.equal(b.player.getAttribute(IKOV_WARRIOR_DEFEATED) ?? 0, 0);
  await h.operate(b, h.door, 'Open'); const other = h.own(b); assert.ok(other);
  PM.emitPlayerLogout({ player: b.player, username: b.player.getUsername() }); // hook fixture keeps actor registered
  h.turns(10);
  assert.equal(h.speech.some(row => row.npc === other), false); assert.equal(h.own(b), undefined); h.closed();
});

test('Ikov foreign death cannot credit a live encounter and relocated authorized carry still restores shared93', async t => {
  const h = ikovWarriorFixture(t), a = h.actor(), b = h.actor();
  await h.operate(a, h.door, 'Open'); const npc = h.own(a); assert.ok(npc); h.turns(10);
  const foreign = PM.spawnNpc({ id: 3448, x: 2647, y: 9867, z: 0, owner: b.player, ownerOnly: true });
  assert.ok(foreign); t.after(() => PM.removeNpc(foreign));
  PM.emitNpcDeath({ killer: a.player, npc: foreign, npcId: 3448 }); // explicit negative event boundary, not death proof
  assert.equal(a.player.getAttribute(IKOV_WARRIOR_DEFEATED) ?? 0, 0); assert.equal(h.own(a), npc);
  await h.lethalOwnedQueue(a, npc); assert.equal(a.player.getAttribute(IKOV_WARRIOR_DEFEATED), 1); h.turns(4);
  await h.operate(a, h.closed(), 'Open'); const force = a.player.getForceMovement(); assert.ok(force);
  const destination = new core.Location(2664, 3420, 0);
  a.player.moveTo(destination); h.turns(4);
  assert.deepEqual(ikovAt(a.player), [2664, 3420, 0], 'stale carry cannot transport a relocated owner from old coordinates');
  assert.equal(a.player.getForceMovement(), null); h.closed();
  assert.equal(b.player.getAttribute(IKOV_WARRIOR_DEFEATED) ?? 0, 0);
  assert.equal(b.player.hasFlag('movement:ignore-clipping'), false);
});

test('Ikov owned playback and retreat cancellation preserve replacement owners and permit a fresh encounter after interruption', async t => {
  const h = ikovWarriorFixture(t), a = h.actor(), b = h.actor();
  function withoutWarriorAttacks(f, npc, check) {
    assert.equal(npc.getOwner(), f.player); assert.equal(npc.isOwnerOnly(), true);
    // Explicit test-only isolation of replacement cancellation from combat UI
    // interruption: discard already incoming hits, pause only this NPC's attack
    // producer for the assertion window, and restore it even on failure.
    const combat = npc.getCombat(), original = combat.postMovementProcess;
    f.player.getCombat().getHitQueue().clearIncoming();
    const attack = t.mock.method(combat, 'postMovementProcess', () => {});
    const hp = f.player.getHitpoints();
    try { check(); assert.equal(f.player.getHitpoints(), hp); }
    finally { attack.mock.restore(); assert.equal(combat.postMovementProcess, original); }
  }
  await h.operate(a, h.door, 'Open'); const npc = h.own(a); assert.ok(npc);
  for (let turn = 0; turn < 8 && !h.speech.some(row => row.npc === npc); turn++) h.turns();
  assert.deepEqual(h.speech.filter(row => row.npc === npc).map(row => row.text), ['You will not pass!']);
  const manager = a.player.getDialogueManager(), sceneEntry = manager.getCurrent(), sceneOwner = manager.getOwner();
  const replacementOwner = {}, replacement = new core.StatementDialogue(0, 'Unrelated replacement dialogue.');
  manager.startDialogues(new core.DialogueChainBuilder().add(replacement), replacementOwner);
  assert.notEqual(replacement, sceneEntry); assert.notEqual(replacementOwner, sceneOwner);
  assert.equal(manager.getCurrent(), replacement); assert.equal(manager.getOwner(), replacementOwner);
  withoutWarriorAttacks(a, npc, () => {
    h.turns(6);
    assert.equal(a.player.getDialogueManager().getCurrent(), replacement, 'scoped cancellation preserves the replacement chain');
    assert.equal(manager.getOwner(), replacementOwner, 'scoped cancellation preserves the replacement owner');
    assert.deepEqual(h.speech.filter(row => row.npc === npc).map(row => row.text), ['You will not pass!']);
  });
  a.player.closeInterruptibleInterfaces();
  await h.operate(a, h.closed(), 'Open'); h.turns(10);
  assert.deepEqual(h.speech.filter(row => row.npc === npc).map(row => row.text),
    ['You will not pass!', 'You will not pass!', 'Amitus! Setitii!'], 'a later real click can start a fresh scene after cancellation');
  await h.operate(b, h.closed(), 'Open'); const other = h.own(b); assert.ok(other);
  for (let turn = 0; turn < 8 && !h.speech.some(row => row.npc === other); turn++) h.turns();
  assert.deepEqual(h.speech.filter(row => row.npc === other).map(row => row.text), ['You will not pass!']);
  b.player.moveTo(new core.Location(2664, 3420, 0)); h.turns(6);
  assert.deepEqual(h.speech.filter(row => row.npc === other).map(row => row.text), ['You will not pass!']);
  assert.deepEqual(ikovAt(b.player), [2664, 3420, 0]); h.closed();
  const c = h.actor();
  await h.operate(c, h.door, 'Open'); const third = h.own(c); assert.ok(third);
  for (let turn = 0; turn < 12 && c.player.getForceMovement() == null; turn++) h.turns();
  const oldForce = c.player.getForceMovement(); assert.ok(oldForce, 'actual transcript retreat is pending');
  const start = c.player.getLocation().clone();
  const replacementForce = new core.ForceMovement(start.clone(), new core.Location(0, 0, 0), 0, 30, 2, -1);
  const replacementTask = new core.ForceMovementTask(c.player, 5, replacementForce);
  core.TaskManager.submit(replacementTask); t.after(() => replacementTask.stop());
  const retreatManager = c.player.getDialogueManager(), retreatEntry = retreatManager.getCurrent();
  const retreatOwner = retreatManager.getOwner(), replacementChainOwner = {};
  const replacementChain = new core.StatementDialogue(0, 'Replacement while retreat is pending.');
  retreatManager.startDialogues(new core.DialogueChainBuilder().add(replacementChain), replacementChainOwner);
  assert.notEqual(replacementChain, retreatEntry); assert.notEqual(replacementChainOwner, retreatOwner);
  assert.equal(retreatManager.getCurrent(), replacementChain);
  assert.equal(retreatManager.getOwner(), replacementChainOwner);
  withoutWarriorAttacks(c, third, () => {
    h.turns(2);
    assert.equal(c.player.getForceMovement(), replacementForce, 'cancelled old retreat preserves the exact replacement force');
    assert.equal(replacementTask.isRunning(), true); assert.deepEqual(ikovAt(c.player), [start.getX(), start.getY(), start.getZ()]);
    assert.equal(c.player.getDialogueManager().getCurrent(), replacementChain);
    assert.equal(retreatManager.getOwner(), replacementChainOwner);
  });
  replacementTask.stop(); c.player.closeInterruptibleInterfaces();
  const before = h.speech.filter(row => row.npc === third).length;
  await h.operate(c, h.closed(), 'Open'); h.turns(10);
  assert.deepEqual(h.speech.filter(row => row.npc === third).slice(before).map(row => row.text),
    ['You will not pass!', 'Amitus! Setitii!'], 'interrupted retreat was not marked successfully completed');
  h.closed();
});

function ikovBridgeFixture(t) {
  const h = ikovFixture(t), y = 9828, west = 2647, east = 2651;
  core.RegionManager.loadMapFiles(2649, y);
  const region = core.getTemplateRegion((41 << 8) | 153);
  assert.ok(region, 'current actual source region for the bridge');
  const span = [];
  for (let x = 2643; x <= 2655; x++)
    if (region.settings[(1 << 12) | ((x & 63) << 6) | (y & 63)] & 2) span.push(x);
  assert.deepEqual(span, [2646, 2647, 2648, 2649, 2650, 2651, 2652],
    'upper bridge settings independently bind both supplied banks');
  for (const x of [west, east]) assert.equal(core.RegionManager.blocked(new core.Location(x, y, 0), null), false);
  const walls = [2648, 2650].map(x => core.MapObjects.get(3550, new core.Location(x, y, 0), null));
  for (const [i, wall] of walls.entries()) {
    assert.ok(wall, 'real shared projected bridge wall');
    assert.deepEqual([wall.getId(), wall.getType(), wall.getFace(), ...ikovAt(wall)],
      [3550, 0, i === 0 ? 2 : 0, i === 0 ? 2648 : 2650, y, 0]);
    assert.equal(wall.getOwner(), null);
  }
  const signature = () => [9828, 9829].flatMap(row => [2648, 2649, 2650]
    .map(x => [x, row, core.RegionManager.getClipping(x, row, 0, null)]));
  const clips = signature(), actors = new Set(), walks = [];
  const emitWalk = PM.emitWalkRoute;
  t.mock.method(PM, 'emitWalkRoute', function(event) {
    const result = Reflect.apply(emitWalk, this, [event]);
    if (actors.has(event.player)) walks.push({ player: event.player, destination: { ...event.destination }, handled: event.handled });
    return result;
  });
  assert.equal(core.RegionManager.canMovestart(new core.Location(2650, y, 0),
    new core.Location(2649, y, 0), 1, 1, null), false, 'ordinary unprivileged path is clipped');
  function actor(worn = true) {
    const f = h.actor(0, walls[1], false, { stand: new core.Location(east, y, 0), hitpoints: 99 });
    actors.add(f.player);
    const boots = new core.Item(I.BOOTS_OF_LIGHTNESS, 1);
    assert.equal(core.ItemDefinition.forId(I.BOOTS_OF_LIGHTNESS).getEquipmentType().getSlot(),
      core.Equipment.FEET_SLOT, 'initial worn boots are actual equippable footwear');
    if (worn) f.player.getEquipment().setItem(core.Equipment.FEET_SLOT, boots);
    else f.player.getInventory().add(boots);
    f.player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.PENDANT_OF_LUCIEN, 1));
    assert.equal(f.player.getHitpoints(), 99);
    assert.equal(f.player.getForceMovement() == null, true);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(f.player.getPrivateArea(), null);
    assert.ok(Number.isFinite(f.player.getCarriedWeightGrams()), 'real item-container inputs produce finite signed grams');
    assert.ok(Number.isFinite(f.player.getWeightKg()), 'display weight is finite');
    assert.equal(f.player.getWeightKg() < 0, worn, 'real worn-weight producer, not a getter stub');
    if (!worn) {
      assert.equal(f.player.getInventory().getAmount(I.BOOTS_OF_LIGHTNESS), 1);
      assert.ok(f.player.getCarriedWeightGrams() >= 0 && f.player.getWeightKg() >= 0, 'unsupported fixture has real nonnegative weight');
    }
    t.after(() => {
      assert.equal(core.TaskManager.hasActiveTask(f.player), false, 'fixture logout stopped its bridge and obstacle work');
      assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
    });
    return f;
  }
  async function walk(f, x, turns = 0) {
    await f.connection.dispatch([{ type: 'move', worldX: x, worldY: y, modifierFlags: 0, run: false }]);
    h.turns(turns);
  }
  async function start(f) {
    await walk(f, west);
    for (let turn = 0; turn < 12 && !f.player.getAttribute('agility.obstacle'); turn++) h.turns();
    const task = f.player.getAttribute('agility.obstacle');
    assert.ok(task?.isRunning(), 'ordinary input reached its owned scripted bridge passage');
    assert.equal(task.player, f.player); assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
    return task;
  }
  function shared() {
    assert.deepEqual(signature(), clips, 'no shared collision edit for anyone');
    for (const [i, wall] of walls.entries())
      assert.equal(core.MapObjects.get(3550, wall.getLocation(), null), wall, 'same real shared wall remains');
  }
  t.after(shared);
  return { ...h, y, west, east, actor, walk, start, shared, walks };
}

test('Ikov documented negative worn weight crosses the actual bridge both ways through ordinary movement input', async t => {
  const h = ikovBridgeFixture(t), f = h.actor(), before = ikovItems(f.player);
  const boots = f.player.getEquipment().getItems()[core.Equipment.FEET_SLOT];
  assert.equal(boots.getId(), I.BOOTS_OF_LIGHTNESS);
  assert.ok(f.player.getCarriedWeightGrams() < -1000 && f.player.getWeightKg() < 0);
  await h.walk(f, h.west);
  const trace = [ikovAt(f.player)];
  for (let turn = 0; turn < 20; turn++) { h.turns(); trace.push(ikovAt(f.player)); }
  assert.ok(h.walks.some(row => row.player === f.player && row.destination.x === h.west && row.destination.y === h.y),
    'the genuine decoded movement reached the current native walk-route producer');
  // The feature-absence baseline must reach THIS target assertion with the
  // preceding actual cache/actor/equipment/input controls intact.
  assert.deepEqual(ikovAt(f.player), [h.west, h.y, 0], 'documented bridge crossing reaches the opposite bank');
  assert.ok(trace.some(at => at[0] >= 2646 && at[0] <= 2652), 'the actual bridge span was entered');
  assert.ok(trace.every(at => at[1] === h.y && at[2] === 0), 'no detour or plane change');
  assert.equal(f.player.getHitpoints(), 99); assert.deepEqual(ikovItems(f.player), before);
  h.shared();
  // Explicit carried-lever checkpoint, not a claim of natural lever acquisition.
  const grams = f.player.getCarriedWeightGrams();
  assert.equal(core.ItemDefinition.forId(I.LEVER).getWeight(), 56);
  f.player.getInventory().add(new core.Item(I.LEVER, 1));
  assert.equal(f.player.getInventory().getAmount(I.LEVER), 1, 'actual 56g checkpoint item was added');
  assert.equal(f.player.getCarriedWeightGrams(), grams + 56); assert.ok(f.player.getWeightKg() < 0);
  const returningItems = ikovItems(f.player);
  await h.walk(f, h.east, 20);
  assert.deepEqual(ikovAt(f.player), [h.east, h.y, 0]); assert.equal(f.player.getHitpoints(), 99);
  assert.deepEqual(ikovItems(f.player), returningItems);
  assert.equal(f.player.getForceMovement() == null, true);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false); h.shared();
});

test('Ikov bridge leaves a concurrent unsupported weight on its unchanged ordinary clipped route', async t => {
  const h = ikovBridgeFixture(t), light = h.actor(), other = h.actor(false);
  assert.ok(other.player.getCarriedWeightGrams() >= 0); const items = ikovItems(other.player);
  await h.walk(light, h.west); await h.walk(other, h.west);
  h.turns(20);
  assert.deepEqual(ikovAt(light.player), [h.west, h.y, 0]);
  assert.ok(other.player.getLocation().getX() >= 2650, 'another player receives no scripted wall crossing');
  assert.equal(other.player.getAttribute('agility.obstacle') == null, true);
  assert.equal(other.player.getHitpoints(), 99, 'this partial feature does not invent a heavy fall');
  assert.deepEqual(ikovItems(other.player), items); h.shared();
});

test('Ikov bridge distinguishes a superseded free approach from a walk rejected during its locked passage', async t => {
  const h = ikovBridgeFixture(t), f = h.actor();
  f.player.moveTo(new core.Location(2658, h.y, 0)); // Supplied initial free-approach setup.
  f.player.setRunning(true); h.turns();
  assert.equal(f.player.isNeedsPlacement(), false); assert.equal(f.player.isRunningReturn(), true);
  await h.walk(f, h.west, 1);
  assert.ok(f.player.getLocation().getX() > 2650, 'replacement is injected before the poll can start a locked crossing');
  assert.equal(f.player.getMovementQueue().getDestination()?.equals(new core.Location(2650, h.y, 0)), true);
  assert.equal(f.player.getAttribute('agility.obstacle') == null, true, 'actual free approach, not the arrival-on-edge boundary');
  await h.walk(f, h.east, 12);
  assert.deepEqual(ikovAt(f.player), [h.east, h.y, 0]); assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  const task = await h.start(f);
  await h.walk(f, h.east, 1);
  assert.equal(f.player.getAttribute('agility.obstacle'), task, 'blocked new walk does not bypass mobility or cancel the passage');
  h.turns(12); assert.deepEqual(ikovAt(f.player), [h.west, h.y, 0]);
  assert.equal(task.isRunning(), false); assert.equal(f.player.getMovementQueue().isMovementBlocked(), false); h.shared();
});

test('Ikov bridge approach preserves an ordinary walk across a real inventory Eat with a native control', async t => {
  const h = ikovBridgeFixture(t), crossing = h.actor(), control = h.actor();
  for (const f of [crossing, control]) {
    // Supplied initial position, running, food and HP. Complete real placement
    // before any ordinary input; no flag clearing or operation-time rescue.
    f.player.moveTo(new core.Location(2658, h.y, 0));
    f.player.setRunning(true);
    f.player.setHitpoints(90); f.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 90, false);
    f.player.getInventory().add(new core.Item(I.SHRIMPS, 1)); h.turns();
    assert.equal(f.player.isNeedsPlacement(), false); assert.equal(f.player.isRunningReturn(), true);
    assert.equal(f.player.getInventory().getAmount(I.SHRIMPS), 1);
    assert.ok(Number.isFinite(f.player.getCarriedWeightGrams()) && f.player.getWeightKg() < 0);
  }
  // Queue both inputs before one shared World turn: advancing a turn for each
  // actor would also advance the other actor's run toward its destination.
  await h.walk(crossing, h.west); await h.walk(control, h.east); h.turns();
  const goals = [crossing, control].map(f => f.player.getMovementQueue().getDestination()?.clone());
  const positions = [crossing, control].map(f => ikovAt(f.player));
  assert.deepEqual(positions, [[2656, h.y, 0], [2656, h.y, 0]], 'the actual native producer advanced two running tiles for both actors');
  assert.ok(goals[0] && goals[1]);
  assert.deepEqual(goals.map(at => [at.getX(), at.getY(), at.getZ()]), [[2650, h.y, 0], [h.east, h.y, 0]]);
  assert.ok(positions[0][0] > 2652 && positions[1][0] > 2653, 'both running paths still have room for the Eat turn');
  assert.equal(crossing.player.getAttribute('agility.obstacle') == null, true);
  for (const f of [crossing, control]) {
    const slot = f.player.getInventory().getSlotForItemId(I.SHRIMPS); assert.ok(slot >= 0);
    await f.connection.dispatch([{ type: 'inventory_action', widgetId: 3214, slot, itemId: I.SHRIMPS, option: 'Eat' }]);
  }
  h.turns();
  for (const [i, f] of [crossing, control].entries()) {
    assert.equal(f.player.getInventory().getAmount(I.SHRIMPS), 0, 'actual inventory action consumed the supplied food');
    assert.ok(f.player.getHitpoints() > 90, 'actual food action healed the actor');
    assert.equal(f.player.getMovementQueue().getDestination()?.equals(goals[i]), true,
      'Eat preserves a still-live native destination before arrival');
    assert.ok(f.player.getLocation().getX() < positions[i][0], 'actual running continues on both routes');
    assert.equal(f.player.isRunningReturn(), true); assert.ok(f.player.getWeightKg() < 0);
  }
  h.turns(20);
  assert.deepEqual(ikovAt(crossing.player), [h.west, h.y, 0]);
  assert.deepEqual(ikovAt(control.player), [h.east, h.y, 0]);
  assert.equal(control.player.getAttribute('agility.obstacle') == null, true);
  assert.equal(crossing.player.getMovementQueue().isMovementBlocked(), false); h.shared();
});

test('Ikov bridge cancellation preserves exact replacement obstacle force and movement holds', async t => {
  const h = ikovBridgeFixture(t), f = h.actor(), other = h.actor();
  const old = await h.start(f), at = f.player.getLocation().clone();
  const force = new core.ForceMovement(at.clone(), new core.Location(0, 0, 0), 0, 30, 2, -1);
  const foreignForce = new core.ForceMovementTask(f.player, 5, force);
  core.TaskManager.submit(foreignForce); t.after(() => foreignForce.stop());
  h.turns();
  assert.equal(old.isRunning(), false); assert.equal(f.player.getForceMovement(), force);
  assert.equal(foreignForce.isRunning(), true); assert.deepEqual(ikovAt(f.player), [at.getX(), at.getY(), at.getZ()]);
  foreignForce.stop();
  await h.walk(f, h.west, 12);
  assert.deepEqual(ikovAt(f.player), [h.west, h.y, 0], 'fresh ordinary movement recovers after the actual foreign force is stopped');
  const oldOther = await h.start(other), otherAt = ikovAt(other.player);
  const runner = require('../plugins/skills/agility/ObstacleRunner.Agility');
  const replacement = runner.run({ player: other.player }, [{ wait: 30 }]);
  t.after(() => replacement.stop());
  h.turns();
  assert.equal(oldOther.isRunning(), false); assert.equal(replacement.isRunning(), true);
  assert.equal(other.player.getAttribute('agility.obstacle'), replacement);
  assert.equal(other.player.getMovementQueue().isMovementBlocked(), true); assert.deepEqual(ikovAt(other.player), otherAt);
  replacement.stop();
  await h.walk(other, h.east, 12);
  assert.deepEqual(ikovAt(other.player), [h.east, h.y, 0], 'fresh ordinary movement recovers after replacement obstacle work ends');
  // Controlled ownership probes: BUSY replacement and movement-hold replacement
  // are independent events, not normal player actions.
  const busyOnly = h.actor(), oldBusy = await h.start(busyOnly), busyQueue = busyOnly.player.getMovementQueue();
  const heldGeneration = busyQueue.getBlockMovementGeneration();
  const holder = new core.Task(30, busyOnly.player, false); holder.execute = () => {};
  core.TaskManager.submit(holder); busyOnly.player.setAttribute('agility.obstacle', holder);
  try {
    h.turns();
    assert.equal(oldBusy.isRunning(), false); assert.equal(holder.isRunning(), true);
    assert.equal(busyOnly.player.getAttribute('agility.obstacle'), holder);
    assert.equal(busyQueue.isMovementBlocked(), false, 'BUSY-only replacement does not leak the old bridge hold');
    assert.notEqual(busyQueue.getBlockMovementGeneration(), heldGeneration, 'owned hold was actually released');
  } finally {
    if (busyOnly.player.getAttribute('agility.obstacle') === holder) busyOnly.player.setAttribute('agility.obstacle', null);
    holder.stop();
  }
  const holdOnly = h.actor(), oldHold = await h.start(holdOnly), holdQueue = holdOnly.player.getMovementQueue();
  holdQueue.setBlockMovement(true); const newGeneration = holdQueue.getBlockMovementGeneration();
  try {
    h.turns();
    assert.equal(oldHold.isRunning(), false); assert.equal(holdOnly.player.getAttribute('agility.obstacle') == null, true);
    assert.equal(holdQueue.isMovementBlocked(), true, 'a genuinely new hold is not the bridge hold');
    assert.equal(holdQueue.getBlockMovementGeneration(), newGeneration);
  } finally {
    if (holdQueue.getBlockMovementGeneration() === newGeneration) holdQueue.setBlockMovement(false);
  }
  h.shared();
});

test('Ikov bridge relocation and actual logout stop the owned passage without an extra endpoint jump', async t => {
  const h = ikovBridgeFixture(t), f = h.actor(), g = h.actor(), k = h.actor();
  const moved = await h.start(f); f.player.moveTo(new core.Location(2664, 3420, 0)); h.turns(3);
  assert.equal(moved.isRunning(), false); assert.deepEqual(ikovAt(f.player), [2664, 3420, 0]);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  const logoutTask = await h.start(g), logoutAt = ikovAt(g.player);
  assert.equal(logoutAt[0], 2649, 'actual immediate first step is between the real walls');
  g.player.onLogout(); // Real method/area/logouthooks; registered test actor and persistence skip remain supplied.
  h.turns(3); assert.equal(logoutTask.isRunning(), false); assert.deepEqual(ikovAt(g.player), logoutAt);
  assert.equal(g.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(g.player.getArea()?.constructor.name, 'TempleOfIkovIceChests', 'registered fixture re-enters through World processing');
  await h.walk(g, h.west, 12);
  assert.deepEqual(ikovAt(g.player), [h.west, h.y, 0], 'ordinary click resumes from observed logout position without placement rescue');
  const fastTask = await h.start(k), fastAt = ikovAt(k.player);
  assert.equal(fastAt[0], 2649);
  require('../plugins/skills/agility/ObstacleRunner.Agility').completeNow(k.player); // Existing logout obstacle boundary.
  h.turns(3); assert.equal(fastTask.isRunning(), false); assert.deepEqual(ikovAt(k.player), fastAt);
  assert.equal(k.player.getMovementQueue().isMovementBlocked(), false);
  await h.walk(k, h.east, 12);
  assert.deepEqual(ikovAt(k.player), [h.east, h.y, 0], 'ordinary reverse click resumes from observed abort position');
  h.shared();
});

test('Ikov bridge only claims its mapped row destination and uses a real nearby approach', async t => {
  const h = ikovBridgeFixture(t), f = h.actor(), other = h.actor();
  await h.walk(f, 2655, 8);
  assert.deepEqual(ikovAt(f.player), [2655, h.y, 0]); assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
  const outsideRow = new core.Location(2654, 9830, 0);
  assert.equal(core.RegionManager.blocked(outsideRow, null), false);
  await f.connection.dispatch([{ type: 'move', worldX: 2654, worldY: 9830, modifierFlags: 0, run: false }]);
  for (let turn = 0; turn < 8; turn++) { h.turns(); assert.equal(f.player.getAttribute('agility.obstacle') == null, true); }
  assert.deepEqual(ikovAt(f.player), [2654, 9830, 0]);
  await h.walk(f, h.west, 20);
  assert.deepEqual(ikovAt(f.player), [h.west, h.y, 0], 'ordinary nearby route approaches the actual bank before crossing');
  await other.connection.dispatch([{ type: 'move', worldX: h.west, worldY: 9830, modifierFlags: 0, run: false }]);
  for (let turn = 0; turn < 20; turn++) { h.turns(); assert.equal(other.player.getAttribute('agility.obstacle') == null, true,
    'an off-row destination is left to ordinary native routing'); }
  h.shared();
});

test('Ikov bridge returns to its remembered entry after real boot removal in either direction', async t => {
  const h = ikovBridgeFixture(t), bootsId = I.BOOTS_OF_LIGHTNESS;
  for (const westward of [true, false]) {
    const f = h.actor(), entry = westward ? 2650 : 2648, target = westward ? h.west : h.east;
    if (!westward) {
      f.player.moveTo(new core.Location(h.west, h.y, 0)); h.turns(); // Actual initial placement completes before input.
      assert.equal(f.player.isNeedsPlacement(), false);
    }
    const initialItems = ikovItems(f.player), initialGrams = f.player.getCarriedWeightGrams();
    assert.ok(Number.isFinite(initialGrams) && f.player.getWeightKg() < 0);
    assert.ok(f.player.getInventory().getFreeSlots() > 0);
    assert.equal(core.ItemDefinition.forId(bootsId).getWeight(), 340);
    await h.walk(f, target);
    for (let turn = 0; turn < 8 && f.player.getLocation().getX() !== entry; turn++) h.turns();
    assert.deepEqual(ikovAt(f.player), [entry, h.y, 0]);
    assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
    // Actual World order: first owned step to2649, then genuine equipment removal.
    await f.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 23,
      groupId: 387, childId: 23, buttonNum: 1 }]);
    h.turns();
    const task = f.player.getAttribute('agility.obstacle');
    assert.ok(task?.isRunning()); assert.deepEqual(ikovAt(f.player), [2649, h.y, 0]);
    assert.equal(f.player.getEquipment().getItems()[core.Equipment.FEET_SLOT].getId(), -1);
    assert.equal(f.player.getInventory().getAmount(bootsId), 1);
    assert.equal(f.player.getCarriedWeightGrams(), initialGrams + 4535 + 340);
    assert.ok(f.player.getWeightKg() >= 0);
    h.turns();
    assert.deepEqual(ikovAt(f.player), [entry, h.y, 0], 'one normal step returns to the actual pre-entry side, never across');
    assert.equal(task.isRunning(), false); assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false); assert.equal(f.player.getHitpoints(), 99);
    await h.walk(f, target, 8);
    assert.deepEqual(ikovAt(f.player), [entry, h.y, 0], 'fresh ineligible input has no free crossing');
    const slot = f.player.getInventory().getSlotForItemId(bootsId); assert.ok(slot >= 0);
    await f.connection.dispatch([{ type: 'inventory_action', widgetId: 3214, slot, itemId: bootsId, option: 'Wear' }]);
    h.turns();
    assert.equal(f.player.getEquipment().getItems()[core.Equipment.FEET_SLOT].getId(), bootsId);
    assert.equal(f.player.getInventory().getAmount(bootsId), 0); assert.equal(f.player.getCarriedWeightGrams(), initialGrams);
    assert.deepEqual(ikovAt(f.player), [entry, h.y, 0], 'ordinary re-wear does not resume the discarded click');
    await h.walk(f, target, 12);
    assert.deepEqual(ikovAt(f.player), [target, h.y, 0]); assert.deepEqual(ikovItems(f.player), initialItems);
    assert.equal(f.player.getHitpoints(), 99); assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  }
  h.shared();
});

test('Ikov bridge abort return yields to an actual replacement force without moving foreign work', async t => {
  const h = ikovBridgeFixture(t), f = h.actor(), bootsId = I.BOOTS_OF_LIGHTNESS;
  const old = await h.start(f);
  assert.deepEqual(ikovAt(f.player), [2649, h.y, 0]);
  await f.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 23,
    groupId: 387, childId: 23, buttonNum: 1 }]);
  h.turns();
  assert.deepEqual(ikovAt(f.player), [2648, h.y, 0]);
  assert.equal(f.player.getEquipment().getItems()[core.Equipment.FEET_SLOT].getId(), -1);
  assert.equal(f.player.getInventory().getAmount(bootsId), 1); assert.ok(f.player.getWeightKg() >= 0);
  h.turns();
  assert.equal(old.isRunning(), true); assert.deepEqual(ikovAt(f.player), [2649, h.y, 0], 'actual normal abort-return step is still owned');
  const at = f.player.getLocation().clone();
  const force = new core.ForceMovement(at.clone(), new core.Location(0, 0, 0), 0, 30, 2, -1);
  const replacement = new core.ForceMovementTask(f.player, 5, force);
  core.TaskManager.submit(replacement); t.after(() => replacement.stop());
  h.turns();
  assert.equal(old.isRunning(), false); assert.equal(replacement.isRunning(), true);
  assert.equal(f.player.getForceMovement(), force); assert.deepEqual(ikovAt(f.player), [2649, h.y, 0]);
  assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false); assert.equal(f.player.getHitpoints(), 99);
  replacement.stop();
  await h.walk(f, h.west, 4);
  assert.deepEqual(ikovAt(f.player), [2650, h.y, 0], 'after foreign work ends an ineligible fresh click returns only to the remembered origin');
  h.turns(8); assert.deepEqual(ikovAt(f.player), [2650, h.y, 0], 'return neither grants a crossing nor resumes the discarded click');
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false); h.shared();
});

test('Ikov bridge uses the attributed review endpoints on row9828 and consumes the original destination', async t => {
  const h = ikovBridgeFixture(t), f = h.actor();
  await h.walk(f, 2648, 16);
  assert.deepEqual(ikovAt(f.player), [2647, 9828, 0], 'review 5911243892 requested west endpoint despite the2648 click');
  h.turns(4); assert.deepEqual(ikovAt(f.player), [2647, 9828, 0], 'original westward click is not resumed');
  await h.walk(f, 2655, 16);
  assert.deepEqual(ikovAt(f.player), [2651, 9828, 0], 'review 5911243892 requested east endpoint despite the2655 click');
  h.turns(4); assert.deepEqual(ikovAt(f.player), [2651, 9828, 0], 'original eastward click is not resumed');
  // An initial adjacent-row setup approaches the supported crossing row. This
  // is a review-request implementation model, not evidence that9829 never crosses in retail.
  const adjacent = h.actor();
  adjacent.player.moveTo(new core.Location(2653, 9829, 0)); h.turns();
  assert.equal(adjacent.player.isNeedsPlacement(), false);
  await adjacent.connection.dispatch([{ type: 'move', worldX: 2648, worldY: 9829, modifierFlags: 0, run: false }]);
  h.turns(20); assert.deepEqual(ikovAt(adjacent.player), [2647, 9828, 0]);
  h.shared();
});

test('Ikov bridge origin survives the actual PlayerSave contract and permits only safe fresh-player recovery', async t => {
  const h = ikovBridgeFixture(t), old = h.actor(), key = 'temple-of-ikov:bridge-origin';
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  await h.walk(old, h.west);
  for (let turn = 0; turn < 8 && old.player.getLocation().getX() !== 2650; turn++) h.turns();
  assert.deepEqual(ikovAt(old.player), [2650, h.y, 0]);
  await old.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 23,
    groupId: 387, childId: 23, buttonNum: 1 }]);
  h.turns();
  assert.deepEqual(ikovAt(old.player), [2649, h.y, 0]); assert.ok(old.player.getWeightKg() >= 0);
  assert.equal(old.player.getEquipment().getItems()[core.Equipment.FEET_SLOT].getId(), -1);
  assert.equal(old.player.getInventory().getAmount(I.BOOTS_OF_LIGHTNESS), 1);
  assert.deepEqual(old.player.getAttribute(key), { version: 1, entryX: 2650 }, 'actual pre-entry provenance exists before logout');
  old.player.onLogout(); // Existing cleanup order, persistence-skip fixture; no SQLite/auth claim.
  assert.deepEqual(ikovAt(old.player), [2649, h.y, 0]);
  const save = PlayerSave.fromPlayer(old.player);
  assert.notEqual(save.position, old.player.getLocation(), 'save clones the actual gap position');
  assert.deepEqual(ikovAt({ getLocation: () => save.position }), [2649, h.y, 0]);
  assert.deepEqual(save.attributes[key], { version: 1, entryX: 2650 });
  assert.notEqual(save.attributes[key], old.player.getAttribute(key), 'attribute provenance is cloned by the real save contract');
  const fresh = h.actor();
  assert.notEqual(fresh.player, old.player); assert.deepEqual(ikovAt(fresh.player), [h.east, h.y, 0]);
  assert.ok(fresh.player.getWeightKg() < 0); assert.equal(fresh.player.getAttribute(key) ?? 0, 0);
  save.applyToPlayer(fresh.player);
  assert.deepEqual(ikovAt(fresh.player), [2649, h.y, 0], 'actual applyToPlayer restored the saved position, without placement rescue');
  assert.deepEqual(fresh.player.getAttribute(key), { version: 1, entryX: 2650 });
  assert.equal(fresh.player.getEquipment().getItems()[core.Equipment.FEET_SLOT].getId(), -1);
  assert.equal(fresh.player.getInventory().getAmount(I.BOOTS_OF_LIGHTNESS), 1); assert.ok(fresh.player.getWeightKg() >= 0);
  await h.walk(fresh, h.west, 4);
  assert.deepEqual(ikovAt(fresh.player), [2650, h.y, 0], 'the new destination cannot change the saved entry or grant an ineligible crossing');
  assert.equal(fresh.player.getAttribute(key), 0); assert.equal(fresh.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(PlayerSave.fromPlayer(fresh.player).attributes[key], undefined, 'completed recovery clears provenance and default0 is omitted from saves');
  h.shared();
});

test('Ikov bridge rejects absent or stale provenance without inventing a start from a new click', async t => {
  const h = ikovBridgeFixture(t), absent = h.actor(), stale = h.actor(), moved = h.actor();
  const key = 'temple-of-ikov:bridge-origin';
  // Explicit negative-control initial placement; there was no passage origin.
  absent.player.moveTo(new core.Location(2649, h.y, 0)); h.turns();
  assert.equal(absent.player.isNeedsPlacement(), false);
  assert.equal(absent.player.getAttribute(key) ?? 0, 0);
  await h.walk(absent, h.west, 6);
  assert.ok(h.walks.some(row => row.player === absent.player && row.destination.x === h.west), 'absence refusal is reached through the actual native route, not a placement-dropped click');
  assert.deepEqual(ikovAt(absent.player), [2649, h.y, 0]); assert.equal(absent.player.getAttribute('agility.obstacle') == null, true);
  const task = await h.start(stale);
  assert.deepEqual(stale.player.getAttribute(key), { version: 1, entryX: 2650 });
  const serial = stale.player.getTeleportSerial();
  stale.player.moveTo(stale.player.getLocation().clone()); // Controlled serial invalidation at the same position.
  assert.notEqual(stale.player.getTeleportSerial(), serial);
  h.turns(); assert.equal(task.isRunning(), false); assert.equal(stale.player.getAttribute(key), 0);
  await h.walk(stale, h.west, 6);
  assert.deepEqual(ikovAt(stale.player), [2649, h.y, 0]); assert.equal(stale.player.getAttribute('agility.obstacle') == null, true);
  const movedTask = await h.start(moved);
  moved.player.moveTo(new core.Location(2654, h.y, 0)); h.turns();
  assert.equal(movedTask.isRunning(), false); assert.equal(moved.player.getAttribute(key), 0, 'leaving the actual gap invalidates old provenance');
  h.shared();
});

test('Ikov bridge holds arrival-turn queued clicks through both endpoints and releases for a later fresh click', async t => {
  const h = ikovBridgeFixture(t);
  for (const westward of [true, false]) {
    const f = h.actor(), target = westward ? h.west : h.east;
    const penultimate = westward ? 2648 : 2650, nearEdge = westward ? 2648 : 2650;
    if (!westward) {
      f.player.moveTo(new core.Location(h.west, h.y, 0)); h.turns();
      assert.equal(f.player.isNeedsPlacement(), false);
    }
    assert.ok(Number.isFinite(f.player.getCarriedWeightGrams()) && f.player.getWeightKg() < 0);
    await h.walk(f, target);
    for (let turn = 0; turn < 12 && !f.player.getAttribute('agility.obstacle'); turn++) h.turns();
    const task = f.player.getAttribute('agility.obstacle'); assert.ok(task?.isRunning());
    for (let turn = 0; turn < 8 && f.player.getLocation().getX() !== penultimate; turn++) h.turns();
    assert.deepEqual(ikovAt(f.player), [penultimate, h.y, 0]);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
    const routed = h.walks.filter(row => row.player === f.player).length;
    // This is a genuine ordinary move queued before the TaskManager turn that
    // reaches the endpoint. It would be a valid same-side bank-to-edge walk.
    await h.walk(f, nearEdge); h.turns();
    assert.deepEqual(ikovAt(f.player), [target, h.y, 0]);
    assert.equal(f.player.getAttribute('agility.obstacle'), task);
    assert.equal(task.isRunning(), true);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), true,
      'attributed review 5911478216 arrival hold includes this packet-processing boundary');
    assert.equal(h.walks.filter(row => row.player === f.player).length, routed,
      'the arrival-turn click is rejected by real mobility before native route dispatch');
    h.turns();
    assert.equal(task.isRunning(), false); assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    h.turns(3); assert.deepEqual(ikovAt(f.player), [target, h.y, 0], 'dropped arrival input never becomes an endpoint tail');
    await h.walk(f, nearEdge, 2);
    assert.deepEqual(ikovAt(f.player), [nearEdge, h.y, 0], 'a later fresh ordinary click works after the hold is released');
    assert.ok(h.walks.filter(row => row.player === f.player).length > routed);
    assert.equal(f.player.getHitpoints(), 99);
  }
  h.shared();
});

test('Ikov bridge arrival hold preserves replacement ownership and does not return after post-arrival boot removal', async t => {
  const h = ikovBridgeFixture(t), f = h.actor(), other = h.actor();
  const initialGrams = f.player.getCarriedWeightGrams();
  assert.ok(Number.isFinite(initialGrams) && f.player.getWeightKg() < 0);
  const task = await h.start(f);
  for (let turn = 0; turn < 8 && f.player.getLocation().getX() !== 2648; turn++) h.turns();
  assert.deepEqual(ikovAt(f.player), [2648, h.y, 0]); assert.ok(f.player.getWeightKg() < 0);
  await f.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 23,
    groupId: 387, childId: 23, buttonNum: 1 }]);
  h.turns();
  assert.deepEqual(ikovAt(f.player), [h.west, h.y, 0]);
  assert.equal(f.player.getInventory().getAmount(I.BOOTS_OF_LIGHTNESS), 1);
  assert.equal(f.player.getEquipment().getItems()[core.Equipment.FEET_SLOT].getId(), -1);
  assert.equal(f.player.getCarriedWeightGrams(), initialGrams + 4535 + 340); assert.ok(f.player.getWeightKg() >= 0);
  assert.equal(f.player.getAttribute('agility.obstacle'), task); assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
  h.turns();
  assert.equal(task.isRunning(), false); assert.deepEqual(ikovAt(f.player), [h.west, h.y, 0],
    'eligibility lost after the actual arrival does not invent a return across the completed span');
  assert.equal(f.player.getAttribute('agility.obstacle') == null, true);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  const old = await h.start(other);
  for (let turn = 0; turn < 8 && other.player.getLocation().getX() !== h.west; turn++) h.turns();
  assert.deepEqual(ikovAt(other.player), [h.west, h.y, 0]); assert.equal(old.isRunning(), true);
  const runner = require('../plugins/skills/agility/ObstacleRunner.Agility');
  const replacement = runner.run({ player: other.player }, [{ wait: 20 }]); t.after(() => replacement.stop());
  const generation = other.player.getMovementQueue().getBlockMovementGeneration();
  h.turns();
  assert.equal(old.isRunning(), false); assert.equal(replacement.isRunning(), true);
  assert.equal(other.player.getAttribute('agility.obstacle'), replacement);
  assert.equal(other.player.getMovementQueue().isMovementBlocked(), true);
  assert.equal(other.player.getMovementQueue().getBlockMovementGeneration(), generation);
  assert.deepEqual(ikovAt(other.player), [h.west, h.y, 0]);
  replacement.stop(); h.shared();
});
