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
    const items = ikovItems(f.player), count = events.length;
    f.shown.length = 0; f.removed.length = 0;
    Reflect.apply(regionChange, core.ObjectManager, tuple);
    assert.deepEqual(ikovItems(f.player), items); assert.equal(events.length, count, 'scene replay performs no chest operation');
    assert.ok(f.shown.every(object => !object.getOwner() || object.getOwner() === f.player), 'no foreign owner loc replay');
  }
  function actor(index = 0) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), player = new Player(session), connection = new ClientConnection(channel);
    connection.player = player; session.setPlayer(player); session.setTurnPacketProcessor(() => connection.processTurnPackets());
    player.setUsername(`ikovchest${++ikovSerial}`); player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
    player.setAttribute('bot-skip-persistence', true);
    const f = { player, connection, shown: [], removed: [] };
    fixtures.set(player, f);
    const sender = player.getPacketSender(), sendObject = sender.sendObject.bind(sender), sendRemoval = sender.sendObjectRemoval.bind(sender);
    sender.sendObject = object => { f.shown.push(object); return sendObject(object); };
    sender.sendObjectRemoval = object => { f.removed.push(object); return sendRemoval(object); };
    assert.equal(core.World.getPlayers().add(player), true);
    const ClimbLinks = require('../plugins/objects/ClimbLinks');
    const object = base(index), at = object.getLocation();
    const stand = ClimbLinks.landingTile(object, { x: at.getX(), y: at.getY() - 1 }, null);
    assert.ok(stand, 'cache geometry supplies initial adjacent stand');
    player.moveTo(stand); // disclosed initial fixture only; operations never relocate to rescue a route
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'temple_of_ikov');
    assert.ok(quest); quest.setStage(player, 10);
    turns(4);
    assert.equal(player.isNeedsPlacement(), false);
    assert.equal(player.getArea()?.constructor.name, 'TempleOfIkovIceChests', 'real registered chest lifecycle area selected');
    assert.ok(tuples.has(player));
    t.after(() => {
      PM.emitPlayerLogout({ player, username: player.getUsername() });
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
  return { actor, base, opened, operate, replay, turns, shared };
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
  await h.operate(b, own, 'Search', false); assert.deepEqual(ikovItems(b.player), bItems);
  await h.operate(a, original, 'Open'); assert.equal(h.opened(a, 0), own, 'stale base Open does not reset stock or duplicate overlay');
  h.replay(a); assert.ok(a.shown.includes(own)); assert.ok(a.removed.includes(original));
  h.replay(b); assert.ok(!b.shown.includes(own)); assert.ok(!b.removed.includes(original));
  await h.operate(b, original, 'Open'); const other = h.opened(b, 0); assert.ok(other); assert.notEqual(other, own);
  h.replay(a); assert.ok(!a.shown.includes(other));
  // One ordinary unforced search per real chest, stopping at the single selected stock.
  for (let index = 0; index < 6 && a.player.getInventory().getAmount(I.ICE_ARROWS) === 0; index++) {
    if (!h.opened(a, index)) await h.operate(a, originals[index], 'Open');
    await h.operate(a, h.opened(a, index), 'Search');
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
  assert.deepEqual(ikovItems(f.player), before); assert.equal(selections, 1); assert.equal(samples, 1);
  h.replay(f); assert.equal(selections, 1); assert.equal(samples, 1);
  await h.operate(f, h.opened(f, 0), 'Shut'); await h.operate(f, base, 'Open');
  await h.operate(f, h.opened(f, 0), 'Search');
  assert.deepEqual(ikovItems(f.player), before); assert.equal(selections, 1); assert.equal(samples, 1);
  f.player.getInventory().deleteNumber(I.ICE_ARROWS, 10);
  await h.operate(f, h.opened(f, 0), 'Search');
  assert.equal(f.player.getInventory().getAmount(I.ICE_ARROWS), limit - 7); assert.equal(samples, 1); assert.equal(selections, 2);
  await h.operate(f, h.opened(f, 0), 'Search');
  assert.equal(f.player.getInventory().getAmount(I.ICE_ARROWS), limit - 4); assert.equal(samples, 2); assert.equal(selections, 3);
});

test('Ikov explicit logout hook cleans only its owner and restores closed visibility before the next ordinary Open', async t => {
  const h = ikovFixture(t), a = h.actor(), b = h.actor(), base = h.base(0);
  await h.operate(a, base, 'Open'); await h.operate(b, base, 'Open');
  const own = h.opened(a, 0), other = h.opened(b, 0), items = ikovItems(a.player);
  a.shown.length = 0;
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() }); // explicit hook fixture, actor remains registered
  assert.equal(h.opened(a, 0), undefined); assert.equal(h.opened(b, 0), other); assert.ok(a.shown.includes(base));
  assert.equal(core.MapObjects.getPrivateArea(a.player, 104, base.getLocation()), null);
  assert.deepEqual(ikovItems(a.player), items);
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(base));
  h.replay(b); assert.ok(b.shown.includes(other));
  PM.emitPlayerLogout({ player: a.player, username: a.player.getUsername() }); // idempotent
  await h.operate(a, base, 'Open'); assert.ok(h.opened(a, 0)); assert.notEqual(h.opened(a, 0), own);
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
  assert.deepEqual(ikovItems(a.player), items);
  a.player.moveTo(start); h.turns(4);
  assert.equal(a.player.getArea(), area); assert.equal(a.player.isNeedsPlacement(), false);
  h.replay(a); assert.ok(!a.shown.includes(own)); assert.ok(!a.removed.includes(base));
  h.replay(b); assert.ok(b.shown.includes(other));
  await h.operate(a, base, 'Open'); assert.ok(h.opened(a, 0)); assert.notEqual(h.opened(a, 0), own);
  await h.operate(a, h.opened(a, 0), 'Search');
  const amount = a.player.getInventory().getAmount(I.ICE_ARROWS); assert.ok(amount >= 0 && amount <= 5);
});
