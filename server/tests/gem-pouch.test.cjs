// Run after `yarn build`: node --test tests/gem-pouch.test.cjs
//
// Pouch, satchel and tote use decoded server dispatch. Cache supplies their actions; Wiki supplies
// recipes and XP. Jagex's release notes say upgrades retain gems and a higher tier blocks lower tiers.
// Mining gem-rock auto-storage follows the poll blog; equal-tier duplicates remain an assumption.
// No capture shows them; no transcript page exists. Ours: every line here, that only mining fills
// an open one, and the upgrade coming out closed.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The real save backend, in a throwaway database.
const savesDir = fs.mkdtempSync(path.join(os.tmpdir(), "gem-pouch-saves-"));
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(savesDir, "players.sqlite");
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = "0";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Storage = require("../plugins/items/storage/Common.StorageItems");

const HOME = [3222, 3218];
const ROCK = [3223, 3218];
const POUCH_XP = 25;
const SATCHEL_XP = 50;

let core;
let I;
let id;
let family;
let next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  id = (name) => core.CacheDefinitions.getObjId(name);
  family = Storage.FAMILIES.get("gem-pouch");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  // The backend keeps its database open until exit, and Windows won't delete it before then.
  process.once("exit", () => {
    try {
      fs.rmSync(savesDir, { recursive: true, force: true });
    } catch {
      // Left in the temp directory.
    }
  });
});

function actor(t, items = [], crafting = 99) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pouchqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, crafting, false);
  p.getSkillManager().setMaxLevel(core.Skill.CRAFTING, crafting);
  const f = { p, c, inv: p.getInventory(), messages };
  for (const item of items) f.inv.add(new core.Item(item), true);
  return f;
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
  f.p.needsPlacement = false;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

async function use(f, itemId, onId) {
  const slot = f.inv.getSlotForItemId(itemId);
  const target = f.inv.getSlotForItemId(onId);
  assert.ok(slot >= 0 && target >= 0, `control: holds ${itemId} and ${onId}`);
  await send(f, { type: "inventory_use_on", slot, itemId, target: { kind: "inventory", slot: target, itemId: onId } });
  ticks(f, 1);
}

async function click(f, itemId, option) {
  const slot = f.inv.getSlotForItemId(itemId);
  assert.ok(slot >= 0, `control: holds ${itemId}`);
  await send(f, { type: "inventory_action", slot, itemId, widgetId: 3214, option });
  ticks(f, 1);
}

const has = (f, itemId) => f.inv.getAmount(itemId);
const stored = (f, gem) => Storage.amountOf(f.p, family, gem);
/** The Crafting XP handed over, before any rate: spied so the world's multiplier doesn't matter. */
function watchXp(t, f) {
  const given = [];
  const skills = f.p.getSkillManager();
  const original = skills.addExperiences.bind(skills);
  t.mock.method(skills, "addExperiences", (skill, amount, ...rest) => {
    if (skill === core.Skill.CRAFTING) given.push(amount);
    return original(skill, amount, ...rest);
  });
  return given;
}
const pouchParts = () => [I.NEEDLE, I.THREAD, I.SILK, id("bolt_of_linen")];
const satchelParts = () => [I.NEEDLE, I.THREAD, I.SILK, id("bolt_of_canvas"), id("gem_pouch")];

// ------------------------------------------------------------------ Crafting

test("a needle on the bolt of linen sews a gem pouch: 25 XP, needle kept, the rest used", async (t) => {
  const f = actor(t, pouchParts());
  const given = watchXp(t, f);
  await use(f, I.NEEDLE, id("bolt_of_linen"));
  assert.equal(has(f, id("gem_pouch")), 1);
  assert.deepEqual([I.THREAD, I.SILK, id("bolt_of_linen")].map((item) => has(f, item)), [0, 0, 0]);
  assert.equal(has(f, I.NEEDLE), 1);
  assert.deepEqual(given, [POUCH_XP]);
});

test("any two components combine, as the Wiki has since 3 June 2026", async (t) => {
  const pairs = () => [[I.THREAD, I.SILK], [I.SILK, id("bolt_of_linen")], [I.NEEDLE, I.SILK]];
  for (const [a, b] of pairs()) {
    const f = actor(t, pouchParts());
    await use(f, a, b);
    assert.equal(has(f, id("gem_pouch")), 1, `${a} on ${b}`);
  }
});

test("needle and thread do not start sewing, even when all parts are present", async (t) => {
  for (const [used, target] of [[I.NEEDLE, I.THREAD], [I.THREAD, I.NEEDLE]]) {
    const parts = pouchParts();
    const f = actor(t, parts);
    const given = watchXp(t, f);
    await use(f, used, target);
    assert.deepEqual(parts.map((item) => has(f, item)), [1, 1, 1, 1]);
    assert.equal(has(f, id("gem_pouch")), 0);
    assert.deepEqual(given, []);
  }
});

test("a costume needle needs no thread", async (t) => {
  const f = actor(t, [I.COSTUME_NEEDLE, I.SILK, id("bolt_of_linen")]);
  await use(f, I.COSTUME_NEEDLE, id("bolt_of_linen"));
  assert.equal(has(f, id("gem_pouch")), 1);
  assert.equal(has(f, I.COSTUME_NEEDLE), 1);
});

test("level 11 can't sew the pouch, and nothing is used", async (t) => {
  const f = actor(t, pouchParts(), 11);
  await use(f, I.NEEDLE, id("bolt_of_linen"));
  assert.equal(has(f, id("gem_pouch")), 0);
  assert.deepEqual(pouchParts().map((item) => has(f, item)), [1, 1, 1, 1]);
  assert.ok(f.messages.some((text) => /level of 12/.test(text)), JSON.stringify(f.messages));
});

test("a missing thread stops it, and nothing is used", async (t) => {
  const f = actor(t, [I.NEEDLE, I.SILK, id("bolt_of_linen")]);
  await use(f, I.NEEDLE, id("bolt_of_linen"));
  assert.equal(has(f, id("gem_pouch")), 0);
  assert.deepEqual([I.NEEDLE, I.SILK, id("bolt_of_linen")].map((item) => has(f, item)), [1, 1, 1]);
  assert.ok(f.messages.some((text) => /need thread/i.test(text)), JSON.stringify(f.messages));
});

test("needle and thread with no bolt or pouch carried stay someone else's business (control)", async (t) => {
  const f = actor(t, [I.NEEDLE, I.THREAD]);
  await use(f, I.NEEDLE, I.THREAD);
  assert.deepEqual([has(f, I.NEEDLE), has(f, I.THREAD)], [1, 1]);
  assert.equal(f.messages.some((text) => /gem pouch|sew/i.test(text)), false, JSON.stringify(f.messages));
});

test("a second pouch isn't refused, and two share one store", async (t) => {
  const f = actor(t, [...pouchParts(), id("gem_pouch")]);
  Storage.store(f.p, family, I.UNCUT_OPAL, 5);
  await use(f, I.NEEDLE, id("bolt_of_linen"));
  assert.equal(has(f, id("gem_pouch")), 2);
  assert.equal(stored(f, I.UNCUT_OPAL), 5);
});

test("the satchel: level 39, 50 XP, uses the pouch, and keeps what it holds", async (t) => {
  const low = actor(t, satchelParts(), 38);
  await use(low, I.NEEDLE, id("bolt_of_canvas"));
  assert.equal(has(low, id("gem_satchel")), 0);
  assert.equal(has(low, id("gem_pouch")), 1);

  const f = actor(t, satchelParts());
  Storage.store(f.p, family, I.UNCUT_OPAL, 5);
  const given = watchXp(t, f);
  await use(f, I.NEEDLE, id("gem_pouch"));
  assert.equal(has(f, id("gem_satchel")), 1);
  assert.equal(has(f, id("gem_pouch")), 0);
  assert.deepEqual([I.THREAD, I.SILK, id("bolt_of_canvas")].map((item) => has(f, item)), [0, 0, 0]);
  assert.deepEqual(given, [SATCHEL_XP]);
  assert.equal(stored(f, I.UNCUT_OPAL), 5, "the store stays");
});

test("an open pouch upgrades too, and comes out closed", async (t) => {
  const f = actor(t, [I.NEEDLE, I.THREAD, I.SILK, id("bolt_of_canvas"), id("gem_pouch_open")]);
  await use(f, I.NEEDLE, id("gem_pouch_open"));
  assert.equal(has(f, id("gem_satchel")), 1);
  assert.equal(has(f, id("gem_pouch_open")), 0);
});

test("a tote upgrade needs 81 Crafting and keeps the satchel contents", async (t) => {
  const parts = () => [I.NEEDLE, I.THREAD, I.SILK, id("bolt_of_cotton"), id("gem_satchel")];
  const low = actor(t, parts(), 80);
  await use(low, id("gem_satchel"), id("bolt_of_cotton"));
  assert.deepEqual(parts().map((item) => has(low, item)), [1, 1, 1, 1, 1]);
  assert.equal(has(low, 33390), 0);

  const f = actor(t, [...parts(), id("gem_bag")], 81);
  Storage.store(f.p, family, I.UNCUT_OPAL, 10);
  Storage.store(f.p, family, I.UNCUT_JADE, 3);
  const given = watchXp(t, f);
  await use(f, id("gem_satchel"), id("bolt_of_cotton"));
  assert.equal(id("gem_tote"), 33390);
  assert.equal(has(f, 33390), 1);
  assert.deepEqual(parts().map((item) => has(f, item)), [1, 0, 0, 0, 0]);
  assert.deepEqual(given, [200]);
  assert.equal(has(f, id("gem_bag")), 1, "gem bag can coexist with the tote");
  assert.deepEqual([stored(f, I.UNCUT_OPAL), stored(f, I.UNCUT_JADE)], [10, 3]);
});

test("higher tiers in inventory or bank prevent lower sewing without consuming anything", async (t) => {
  const cases = [
    { owned: ["gem_satchel", "gem_satchel_open"], parts: () => pouchParts(), product: "gem_pouch" },
    { owned: ["gem_tote", "gem_tote_open"], parts: () => satchelParts(), product: "gem_satchel" },
    { owned: ["gem_sack", "gem_sack_open"], parts: () => pouchParts(), product: "gem_pouch" },
    { owned: ["gem_sack", "gem_sack_open"], parts: () => satchelParts(), product: "gem_satchel" },
    { owned: ["gem_sack", "gem_sack_open"], parts: () => [I.NEEDLE, I.THREAD, I.SILK, id("bolt_of_cotton"), id("gem_satchel")], product: "gem_tote" },
  ];
  for (const row of cases) for (const name of row.owned) for (const banked of [false, true]) {
    const parts = row.parts();
    const f = actor(t, banked ? parts : [...parts, id(name)]);
    if (banked) f.p.getBank(0).add(new core.Item(id(name)), false);
    Storage.store(f.p, family, I.UNCUT_OPAL, 3);
    const given = watchXp(t, f);
    // Shared-only inputs test recipe selection as well as the ownership check.
    await use(f, I.THREAD, I.SILK);
    assert.deepEqual(parts.map((item) => has(f, item)), parts.map(() => 1), `${name}, banked=${banked}`);
    assert.equal(has(f, id(row.product)), 0);
    assert.equal(banked ? f.p.getBank(0).getAmount(id(name)) : has(f, id(name)), 1);
    assert.equal(stored(f, I.UNCUT_OPAL), 3);
    assert.deepEqual(given, []);
  }
});

test("shared sewing components can choose the tote recipe", async (t) => {
  const f = actor(t, [I.NEEDLE, I.THREAD, I.SILK, id("bolt_of_cotton"), id("gem_satchel")], 81);
  await use(f, I.SILK, I.THREAD);
  assert.equal(has(f, id("gem_tote")), 1);
});

test("an open satchel upgrades to a closed tote without losing its gems", async (t) => {
  const f = actor(t, [I.COSTUME_NEEDLE, I.SILK, id("bolt_of_cotton"), id("gem_satchel_open")]);
  Storage.store(f.p, family, I.UNCUT_RED_TOPAZ, 7);
  await use(f, id("gem_satchel_open"), id("bolt_of_cotton"));
  assert.equal(has(f, 33390), 1);
  assert.equal(has(f, id("gem_satchel_open")), 0);
  assert.equal(stored(f, I.UNCUT_RED_TOPAZ), 7);
});

test("a tote holds 20 each and Empty conserves what fits", async (t) => {
  const f = actor(t, [33390, ...Array(12).fill(I.UNCUT_OPAL), I.UNCUT_SAPPHIRE]);
  Storage.store(f.p, family, I.UNCUT_OPAL, 10);
  await click(f, 33390, "Fill");
  assert.equal(stored(f, I.UNCUT_OPAL), 20);
  assert.equal(has(f, I.UNCUT_OPAL), 2);
  assert.equal(has(f, I.UNCUT_SAPPHIRE), 1);
  await click(f, 33390, "Check");
  assert.match(f.messages.at(-1), /Opal: 20/);
  await click(f, 33390, "Empty");
  assert.equal(has(f, I.UNCUT_OPAL) + stored(f, I.UNCUT_OPAL), 22);
  assert.equal(stored(f, I.UNCUT_OPAL), 0);
});

// Sack upgrade joins two per-player stores. The legacy duplicate refusal is our conservative
// policy for states this server allowed, not a claim about a live-game message.
for (const reason of ["level", "skin", "needle", "thread", "bag", "tote"]) {
  test(`a sack recipe refused for ${reason} gives feedback and preserves its contents`, async (t) => {
    const tote = id("gem_tote"), bag = id("gem_bag");
    const parts = [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag];
    const missing = { skin: I.IMMACULATE_MOLE_SKIN, needle: I.NEEDLE, thread: I.THREAD, bag, tote }[reason];
    const items = parts.filter((item) => item !== missing);
    const pair = reason === "bag" ? [I.NEEDLE, tote] : reason === "tote" ? [I.NEEDLE, bag] : [bag, tote];
    const message = {
      level: /Crafting level of 81/i, skin: /need immaculate mole skin/i, needle: /need needle/i,
      thread: /need thread/i, bag: /need gem bag/i, tote: /need gem tote/i,
    }[reason];
    const bagFamily = Storage.FAMILIES.get("gem-bag");
    for (const reverse of [false, true]) {
      const f = actor(t, items, reason === "level" ? 80 : 81);
      Storage.store(f.p, family, I.UNCUT_OPAL, 4);
      Storage.store(f.p, bagFamily, I.UNCUT_RUBY, 3);
      const given = watchXp(t, f), before = parts.map((item) => has(f, item));
      await use(f, ...(reverse ? [...pair].reverse() : pair));
      assert.deepEqual(parts.map((item) => has(f, item)), before, `items, reverse=${reverse}`);
      assert.equal(has(f, id("gem_sack")), 0);
      assert.deepEqual([stored(f, I.UNCUT_OPAL), Storage.amountOf(f.p, bagFamily, I.UNCUT_RUBY)], [4, 3]);
      assert.deepEqual(given, []);
      assert.ok(f.messages.some((text) => message.test(text)), `reason=${reason} reverse=${reverse}: ${JSON.stringify(f.messages)}`);
    }
  });
}

test("an empty inventory gives sack Fill feedback", async (t) => {
  const f = actor(t, [id("gem_sack")]);
  await click(f, id("gem_sack"), "Fill");
  assert.ok(f.messages.some((text) => /nothing suitable.*sack/i.test(text)), JSON.stringify(f.messages));
});

test("a full sack gives Fill feedback without consuming a gem", async (t) => {
  const f = actor(t, [id("gem_sack"), I.UNCUT_OPAL]);
  const sack = Storage.FAMILIES.get("gem-sack");
  Storage.store(f.p, sack, I.UNCUT_OPAL, 60);
  await click(f, id("gem_sack"), "Fill");
  assert.equal(has(f, I.UNCUT_OPAL), 1);
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_OPAL), 60);
  assert.ok(f.messages.some((text) => /sack.*full/i.test(text)), JSON.stringify(f.messages));
});

test("an empty sack gives Empty feedback in inventory and at the bank", async (t) => {
  const f = actor(t, [id("gem_sack")]);
  await click(f, id("gem_sack"), "Empty");
  assert.match(f.messages.at(-1), /gem sack is empty/i);
  const prior = f.messages.length;
  Storage.FAMILIES.get("gem-sack").bankEmpty(f.p);
  assert.equal(f.messages.length, prior + 1);
  assert.match(f.messages.at(-1), /gem sack is empty/i);
});

test("upgrading tote and real gem bag to a sack conserves both stores", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag], 81);
  const bagFamily = Storage.FAMILIES.get("gem-bag");
  Storage.store(f.p, family, I.UNCUT_OPAL, 4);
  Storage.store(f.p, bagFamily, I.UNCUT_RUBY, 3);
  const given = watchXp(t, f);
  await use(f, tote, bag);
  assert.equal(id("gem_sack"), 33393);
  assert.equal(has(f, 33393), 1);
  assert.deepEqual([tote, bag, I.THREAD, I.IMMACULATE_MOLE_SKIN].map((item) => has(f, item)), [0, 0, 0, 0]);
  assert.equal(has(f, I.NEEDLE), 1);
  assert.deepEqual(given, [300]);
  assert.equal(f.messages.filter((text) => text === "You sew a gem sack.").length, 1);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  assert.deepEqual([Storage.amountOf(f.p, sack, I.UNCUT_OPAL), Storage.amountOf(f.p, sack, I.UNCUT_RUBY)], [4, 3]);
  assert.equal(Storage.total(f.p, family) + Storage.total(f.p, bagFamily), 0);
  await click(f, 33393, "Check");
  await click(f, 33393, "Empty");
  assert.deepEqual([has(f, I.UNCUT_OPAL), has(f, I.UNCUT_RUBY)], [4, 3]);
  assert.equal(Storage.total(f.p, sack), 0);
});

test("sack Check labels gems consistently with the pouch", async (t) => {
  const f = actor(t, [id("gem_sack")]);
  Storage.store(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_OPAL, 4);
  await click(f, id("gem_sack"), "Check");
  assert.match(f.messages.at(-1), /Opal: 4/);
  assert.doesNotMatch(f.messages.at(-1), /Uncut /);
});

test("a sack upgrade with another real gem bag refuses without changing items or stores", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag, bag]);
  const bagFamily = Storage.FAMILIES.get("gem-bag");
  Storage.store(f.p, family, I.UNCUT_OPAL, 4);
  Storage.store(f.p, bagFamily, I.UNCUT_RUBY, 3);
  const given = watchXp(t, f);
  await use(f, bag, tote);
  assert.deepEqual([has(f, tote), has(f, bag), has(f, I.THREAD), has(f, I.IMMACULATE_MOLE_SKIN), has(f, 33393)], [1, 2, 1, 1, 0]);
  assert.deepEqual([stored(f, I.UNCUT_OPAL), Storage.amountOf(f.p, bagFamily, I.UNCUT_RUBY)], [4, 3]);
  assert.deepEqual(given, []);
});

test("a banked duplicate blocks sack upgrade without losing either store", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
  f.p.getBank(0).add(new core.Item(id("gem_satchel")), false);
  const bagFamily = Storage.FAMILIES.get("gem-bag");
  Storage.store(f.p, family, I.UNCUT_OPAL, 4);
  Storage.store(f.p, bagFamily, I.UNCUT_RUBY, 3);
  await use(f, tote, bag);
  assert.deepEqual([has(f, tote), has(f, bag), has(f, 33393)], [1, 1, 0]);
  assert.deepEqual([stored(f, I.UNCUT_OPAL), Storage.amountOf(f.p, bagFamily, I.UNCUT_RUBY)], [4, 3]);
  assert.equal(f.p.getBank(0).getAmount(id("gem_satchel")), 1);
});

test("banked or equipped duplicate real bags block upgrade and preserve inputs", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  const bagFamily = Storage.FAMILIES.get("gem-bag");
  for (const where of ["bank", "equipment"]) {
    const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
    if (where === "bank") f.p.getBank(0).add(new core.Item(bag), false);
    else f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(bag));
    Storage.store(f.p, family, I.UNCUT_OPAL, 4);
    Storage.store(f.p, bagFamily, I.UNCUT_RUBY, 3);
    const given = watchXp(t, f);
    await use(f, tote, bag);
    assert.deepEqual([has(f, tote), has(f, bag), has(f, I.THREAD), has(f, I.IMMACULATE_MOLE_SKIN), has(f, 33393)], [1, 1, 1, 1, 0]);
    assert.deepEqual([stored(f, I.UNCUT_OPAL), Storage.amountOf(f.p, bagFamily, I.UNCUT_RUBY)], [4, 3]);
    assert.deepEqual(given, []);
  }
});

test("sack destroy event clears only the last owned copy's store", (t) => {
  const f = actor(t, [33393, 33393]);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  Storage.store(f.p, sack, I.UNCUT_OPAL, 4);
  f.inv.deleteNumber(33393, 1);
  PM.emitCustomEvent("destroy-item:destroyed", { player: f.p, itemId: 33393 });
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_OPAL), 4);
  f.inv.deleteNumber(33393, 1);
  PM.emitCustomEvent("destroy-item:destroyed", { player: f.p, itemId: 33393 });
  assert.equal(Storage.total(f.p, sack), 0);
});

test("sack ingredients route in either direction and incomplete recipes leave items intact", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  for (const component of [I.NEEDLE, I.THREAD]) for (const reverse of [false, true]) {
    const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
    await use(f, ...(reverse ? [tote, component] : [component, tote]));
    assert.equal(has(f, 33393), 1, `component=${component} reverse=${reverse}`);
    const missing = actor(t, [I.NEEDLE, I.THREAD, tote]);
    await use(missing, ...(reverse ? [tote, component] : [component, tote]));
    assert.deepEqual([has(missing, tote), has(missing, I.THREAD), has(missing, 33393)], [1, 1, 0]);
  }
});

test("invalid saved source records block upgrade without changing either raw store or items", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  const cases = ["invalid", [[]], [[1.5, 1]], [[I.UNCUT_OPAL, 1], [I.UNCUT_OPAL, 2]], [[I.UNCUT_RUBY, 1]], [[I.UNCUT_OPAL, 1.5]], [[I.UNCUT_OPAL, 61]]];
  for (const raw of cases) {
    const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
    f.p.setAttribute("storage-items:gem-pouch", raw);
    f.p.setAttribute("storage-items:gem-bag", [[I.UNCUT_RUBY, 3]]);
    const given = watchXp(t, f);
    await use(f, tote, bag);
    assert.deepEqual(f.p.getAttribute("storage-items:gem-pouch"), raw);
    assert.deepEqual(f.p.getAttribute("storage-items:gem-bag"), [[I.UNCUT_RUBY, 3]]);
    assert.deepEqual([has(f, tote), has(f, bag), has(f, I.THREAD), has(f, I.IMMACULATE_MOLE_SKIN), has(f, 33393)], [1, 1, 1, 1, 0]);
    assert.deepEqual(given, []);
  }
});

test("an unowned sack store joins both lower stores and can be emptied", async (t) => {
  const tote = id("gem_tote"), bag = id("gem_bag"), sack = Storage.FAMILIES.get("gem-sack");
  const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
  f.p.setAttribute("storage-items:gem-sack", [[I.UNCUT_OPAL, 2], [I.UNCUT_RUBY, 5], [I.UNCUT_JADE, 1]]);
  f.p.setAttribute("storage-items:gem-pouch", [[I.UNCUT_OPAL, 4]]);
  f.p.setAttribute("storage-items:gem-bag", [[I.UNCUT_RUBY, 3]]);
  const given = watchXp(t, f);
  await use(f, tote, bag);
  assert.equal(has(f, id("gem_sack")), 1);
  assert.deepEqual([I.UNCUT_OPAL, I.UNCUT_RUBY, I.UNCUT_JADE].map((item) => Storage.amountOf(f.p, sack, item)), [6, 8, 1]);
  assert.equal(Storage.total(f.p, family) + Storage.total(f.p, Storage.FAMILIES.get("gem-bag")), 0);
  assert.deepEqual(given, [300]);
  await click(f, id("gem_sack"), "Empty");
  assert.deepEqual([I.UNCUT_OPAL, I.UNCUT_RUBY, I.UNCUT_JADE].map((item) => has(f, item)), [6, 8, 1]);
  assert.equal(Storage.total(f.p, sack), 0);
});

test("orphaned contents merge at capacity and refuse overflow without mutation", async (t) => {
  const tote = id("gem_tote"), bag = id("gem_bag"), sack = Storage.FAMILIES.get("gem-sack");
  for (const amount of [58, 59]) {
    const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
    const orphan = [[I.UNCUT_OPAL, 2]], pouch = [[I.UNCUT_OPAL, amount]], gems = [[I.UNCUT_RUBY, 3]];
    f.p.setAttribute("storage-items:gem-sack", orphan);
    f.p.setAttribute("storage-items:gem-pouch", pouch);
    f.p.setAttribute("storage-items:gem-bag", gems);
    const given = watchXp(t, f);
    await use(f, tote, bag);
    if (amount === 58) {
      assert.equal(has(f, id("gem_sack")), 1);
      assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_OPAL), 60);
      assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_RUBY), 3);
      assert.deepEqual(given, [300]);
    } else {
      assert.deepEqual([has(f, tote), has(f, bag), has(f, I.THREAD), has(f, I.IMMACULATE_MOLE_SKIN), has(f, id("gem_sack"))], [1, 1, 1, 1, 0]);
      assert.deepEqual(f.p.getAttribute("storage-items:gem-sack"), orphan);
      assert.deepEqual(f.p.getAttribute("storage-items:gem-pouch"), pouch);
      assert.deepEqual(f.p.getAttribute("storage-items:gem-bag"), gems);
      assert.deepEqual(given, []);
    }
  }
});

test("owned sack variants block upgrade without mutation", async (t) => {
  const tote = id("gem_tote");
  const bag = id("gem_bag");
  for (const variant of [33393, 33395]) for (const where of ["inventory", "bank"]) {
    const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
    if (where === "bank") f.p.getBank(0).add(new core.Item(variant), false);
    else f.inv.add(new core.Item(variant), false);
    const before = f.p.getAttribute("storage-items:gem-sack");
    const given = watchXp(t, f);
    await use(f, tote, bag);
    assert.deepEqual([has(f, tote), has(f, bag), has(f, I.THREAD), has(f, I.IMMACULATE_MOLE_SKIN)], [1, 1, 1, 1]);
    assert.deepEqual(f.p.getAttribute("storage-items:gem-sack"), before);
    assert.deepEqual(given, []);
  }
});

test("invalid orphaned sack records refuse without changing any store or item", async (t) => {
  const tote = id("gem_tote"), bag = id("gem_bag");
  for (const raw of ["invalid", [[I.UNCUT_OPAL, 1], [I.UNCUT_OPAL, 2]], [[I.UNCUT_OPAL, 61]], [[I.RAKE, 1]]]) {
    const f = actor(t, [I.NEEDLE, I.THREAD, I.IMMACULATE_MOLE_SKIN, tote, bag]);
    f.p.setAttribute("storage-items:gem-sack", raw);
    f.p.setAttribute("storage-items:gem-pouch", [[I.UNCUT_OPAL, 4]]);
    f.p.setAttribute("storage-items:gem-bag", [[I.UNCUT_RUBY, 3]]);
    const given = watchXp(t, f);
    await use(f, tote, bag);
    assert.deepEqual(f.p.getAttribute("storage-items:gem-sack"), raw);
    assert.deepEqual(f.p.getAttribute("storage-items:gem-pouch"), [[I.UNCUT_OPAL, 4]]);
    assert.deepEqual(f.p.getAttribute("storage-items:gem-bag"), [[I.UNCUT_RUBY, 3]]);
    assert.deepEqual([has(f, tote), has(f, bag), has(f, I.THREAD), has(f, I.IMMACULATE_MOLE_SKIN)], [1, 1, 1, 1]);
    assert.deepEqual(given, []);
  }
});

test("sack caps each gem class at 60 and keeps the extra in inventory", async (t) => {
  const f = actor(t, [33393, I.UNCUT_OPAL, I.UNCUT_OPAL, I.UNCUT_RUBY, I.UNCUT_RUBY]);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  Storage.store(f.p, sack, I.UNCUT_OPAL, 59);
  Storage.store(f.p, sack, I.UNCUT_RUBY, 59);
  await click(f, 33393, "Fill");
  assert.deepEqual([Storage.amountOf(f.p, sack, I.UNCUT_OPAL), Storage.amountOf(f.p, sack, I.UNCUT_RUBY)], [60, 60]);
  assert.deepEqual([has(f, I.UNCUT_OPAL), has(f, I.UNCUT_RUBY)], [1, 1]);
});

test("an open sack takes a mined semi-precious gem", async (t) => {
  assert.equal(id("gem_sack_open"), 33395);
  const f = actor(t, [33395]);
  await mineOpal(t, f);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_OPAL), 1);
  assert.equal(has(f, I.UNCUT_OPAL), 0);
});

// ------------------------------------------------------------------ Holding gems

for (const [closed, open] of [["gem_pouch", "gem_pouch_open"], ["gem_satchel", "gem_satchel_open"], ["gem_tote", "gem_tote_open"]]) {
  test(`${closed} opens and closes by click`, async (t) => {
    const f = actor(t, [id(closed)]);
    await click(f, id(closed), "Open");
    assert.equal(has(f, id(open)), 1);
    await click(f, id(open), "Close");
    assert.equal(has(f, id(closed)), 1);
  });
}

test("Fill holds 5 of each in a pouch, leaves the rest, and refuses precious gems", async (t) => {
  const gems = [...Array(6).fill(0).map(() => I.UNCUT_OPAL), I.UNCUT_JADE, I.UNCUT_RED_TOPAZ, I.UNCUT_SAPPHIRE];
  const f = actor(t, [id("gem_pouch"), ...gems]);
  await click(f, id("gem_pouch"), "Fill");
  assert.equal(stored(f, I.UNCUT_OPAL), 5);
  assert.equal(has(f, I.UNCUT_OPAL), 1);
  assert.equal(stored(f, I.UNCUT_JADE), 1);
  assert.equal(stored(f, I.UNCUT_RED_TOPAZ), 1);
  assert.equal(has(f, I.UNCUT_SAPPHIRE), 1);
});

test("a satchel holds 10 of each, and the pouch's 5 count towards it", async (t) => {
  const f = actor(t, [id("gem_satchel"), ...Array(7).fill(I.UNCUT_OPAL)]);
  Storage.store(f.p, family, I.UNCUT_OPAL, 5);
  await click(f, id("gem_satchel"), "Fill");
  assert.equal(stored(f, I.UNCUT_OPAL), 10);
  assert.equal(has(f, I.UNCUT_OPAL), 2);
});

test("Check counts them, and Empty brings back what fits and keeps the rest", async (t) => {
  const f = actor(t, [id("gem_pouch")]);
  Storage.store(f.p, family, I.UNCUT_JADE, 3);
  await click(f, id("gem_pouch"), "Check");
  assert.match(f.messages.at(-1), /Jade: 3/);
  while (f.inv.getFreeSlots() > 1) f.inv.add(new core.Item(I.RAKE), false);
  await click(f, id("gem_pouch"), "Empty");
  assert.equal(has(f, I.UNCUT_JADE), 1);
  assert.equal(stored(f, I.UNCUT_JADE), 2);
});

test("stored gems and the open state survive a save and reload", async (t) => {
  const f = actor(t, [id("gem_satchel_open")]);
  Storage.store(f.p, family, I.UNCUT_RED_TOPAZ, 7);
  const username = f.p.getUsername();
  PM.emitPlayerLogout({ player: f.p, username });
  const backend = core.GameConstants.PLAYER_PERSISTENCE;
  backend.save(f.p, "logout");
  await backend.flush();
  const g = actor(t);
  g.p.setUsername(username);
  backend.load(username).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username });
  assert.equal(has(g, id("gem_satchel_open")), 1);
  assert.equal(stored(g, I.UNCUT_RED_TOPAZ), 7);
});

// ------------------------------------------------------------------ Gem rocks

async function mineOpal(t, f) {
  f.inv.add(new core.Item(I.BRONZE_PICKAXE), true);
  f.p.getSkillManager().setCurrentLevel(core.Skill.MINING, 99, false);
  f.p.getSkillManager().setMaxLevel(core.Skill.MINING, 99);
  const rockId = core.CacheDefinitions.getLocId("gemrock");
  const rock = new core.GameObject(rockId, new core.Location(ROCK[0], ROCK[1], 0), 10, 0, null);
  core.ObjectManager.register(rock, true);
  t.after(() => core.ObjectManager.deregister(rock, true));
  // 0 lands the swing's roll and the outcome table's first row, the opal.
  t.mock.method(Math, "random", () => 0);
  await send(f, { type: "object_option", id: rockId, x: ROCK[0], y: ROCK[1], action: "Mine" });
  ticks(f, 30);
}

test("an open pouch takes a mined opal", async (t) => {
  const f = actor(t, [id("gem_pouch_open")]);
  await mineOpal(t, f);
  assert.equal(stored(f, I.UNCUT_OPAL), 1);
  assert.equal(has(f, I.UNCUT_OPAL), 0);
});

test("an open tote takes a mined opal", async (t) => {
  assert.equal(id("gem_tote_open"), 33392);
  const f = actor(t, [33392]);
  await mineOpal(t, f);
  assert.equal(stored(f, I.UNCUT_OPAL), 1);
  assert.equal(has(f, I.UNCUT_OPAL), 0);
});

test("a closed pouch leaves the mined opal in the inventory", async (t) => {
  const f = actor(t, [id("gem_pouch")]);
  await mineOpal(t, f);
  assert.equal(stored(f, I.UNCUT_OPAL), 0);
  assert.equal(has(f, I.UNCUT_OPAL), 1);
});

test("a full open pouch sends the mined opal to the inventory", async (t) => {
  const f = actor(t, [id("gem_pouch_open")]);
  Storage.store(f.p, family, I.UNCUT_OPAL, 5);
  await mineOpal(t, f);
  assert.equal(stored(f, I.UNCUT_OPAL), 5);
  assert.equal(has(f, I.UNCUT_OPAL), 1);
});

test("an open pouch with room lets a full inventory go on mining gem rocks", async (t) => {
  const f = actor(t, [id("gem_pouch_open"), I.BRONZE_PICKAXE]);
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.delete(I.BRONZE_PICKAXE, 1); // mineOpal hands it back, into this last slot
  await mineOpal(t, f);
  assert.equal(stored(f, I.UNCUT_OPAL), 1);
});

test("a gather that isn't Mining stays out: only mining is evidenced", (t) => {
  const f = actor(t, [id("gem_pouch_open")]);
  const request = { player: f.p, itemId: I.UNCUT_OPAL, amount: 1, stored: 0 };
  PM.emitCustomEvent(Storage.GATHER_EVENT, request);
  assert.equal(request.stored, 0);
  assert.equal(stored(f, I.UNCUT_OPAL), 0);
});
