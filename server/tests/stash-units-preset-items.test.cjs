// Run after `yarn build`: node --test tests/stash-units-preset-items.test.cjs
// A STASH unit keeps only item ids and hands back plain copies, so it never stores a preset or meta-untradeable
// copy (Presets.PvpMode tags them untradeable, unbankable and preset), or a preset outfit would come back
// tradeable. Real engine: every plugin loaded, a real Player and Inventory, the unit's own interaction handler
// (store, then take) as it registers it, and a real STASH unit from the clue data.
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
let next = 9810;
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
  p.setUsername("stash" + p.getIndex());
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

const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const PRESET_TEXT = "Preset items cannot be used for this.";

/** The unit's own handler, and a built unit whose emote step names explicit items. */
function stashUnit(f) {
  let interact = null;
  const real = PM.createApi("StashPresetTest");
  Stash(new Proxy(real, { get: (target, key) => (key === "onBeforeObjectInteraction" ? (handler) => { interact = handler; } : target[key]) }));
  for (const [locId, unit] of Stash.stashes()) {
    const needs = unit.step.equipment.filter((requirement) => requirement.emptySlot == null);
    if (needs.length > 1 && needs.every((requirement) => Array.isArray(requirement.anyOf) && requirement.anyOf.length)) {
      f.p.setAttribute(Stash.BUILT_ATTRIBUTE, [locId]);
      return { use: () => interact({ player: f.p, objectId: locId, handled: false }), ids: needs.map((requirement) => requirement.anyOf[0]), locId };
    }
  }
  throw new Error("no STASH unit with explicit items");
}

test("an outfit held only as preset copies is not stored", (t) => {
  const f = actor(t);
  const unit = stashUnit(f);
  unit.ids.forEach((id, slot) => f.inv.setItem(slot, preset(new core.Item(id, 1))));
  unit.use();
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  for (const id of unit.ids) assert.equal(amount(f.inv, id, true), 1);
  assert.equal(f.p.getAttribute(Stash.STORED_ATTRIBUTE)?.[unit.locId], undefined, "nothing stored");
});

test("with preset and plain copies held, only the plain ones are stored and come back", (t) => {
  const f = actor(t);
  const unit = stashUnit(f);
  unit.ids.forEach((id, slot) => f.inv.setItem(slot, preset(new core.Item(id, 1)))); // first in slot order
  unit.ids.forEach((id, slot) => f.inv.setItem(10 + slot, new core.Item(id, 1)));
  unit.use();
  assert.equal(f.messages.at(-1), "You store the items in the STASH unit.");
  for (const id of unit.ids) {
    assert.equal(amount(f.inv, id, true), 1, "the preset copies are left alone");
    assert.equal(amount(f.inv, id, false), 0);
  }
  unit.use();
  assert.equal(f.messages.at(-1), "You take the items out of the STASH unit.");
  for (const id of unit.ids) {
    assert.equal(amount(f.inv, id, false), 1);
    assert.equal(amount(f.inv, id, true), 1);
  }
});

// Wiki (Amy's saw): it works as a saw and can be wielded; the one saw rule (items/Saws.js) counts it held or worn.
test("a STASH unit builds with Amy's saw wielded in either hand, and not without a saw", (t) => {
  let interact = null;
  const real = PM.createApi("StashSawTest");
  Stash(new Proxy(real, { get: (target, key) => (key === "onBeforeObjectInteraction" ? (handler) => { interact = handler; } : target[key]) }));
  const [locId, unit] = [...Stash.stashes()].find(([, entry]) => entry.tier.name === "easy");
  const stock = (f) => {
    f.p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false).setCurrentLevels(core.Skill.CONSTRUCTION, 99, false);
    f.inv.add(new core.Item(I.HAMMER, 1));
    f.inv.add(new core.Item(I.PLANK, 2));
    f.inv.add(new core.Item(I.BRONZE_NAILS, 10));
  };
  const built = (f) => (f.p.getAttribute(Stash.BUILT_ATTRIBUTE) ?? []).includes(locId);
  for (const [slot, sawId] of [[core.Equipment.WEAPON_SLOT, I.AMYS_SAW], [core.Equipment.SHIELD_SLOT, I.AMYS_SAW_OFF_HAND_]]) {
    const f = actor(t);
    stock(f);
    f.p.getEquipment().set(slot, new core.Item(sawId, 1));
    interact({ player: f.p, objectId: locId, handled: false });
    assert.equal(built(f), true, `built with ${sawId} wielded`);
  }
  const f = actor(t);
  stock(f);
  interact({ player: f.p, objectId: locId, handled: false });
  assert.equal(built(f), false, "no saw: not built");
  assert.equal(f.messages.at(-1), "You need a saw and a hammer in order to build a STASH unit here.");
  assert.ok(unit);
});

// Wiki (STASH): "any hammer and saw"; the Imcando hammer works as a hammer, wielded too (items/Hammers.js).
// Recordings: "You need a saw and a hammer in order to build a STASH unit here." for the tools (242/912100.txt),
// "You do not have the required materials to build a STASH unit here." (227/910308.txt) and "You build a STASH
// unit." (spam, 227/01768.txt) as it is built.
test("a STASH unit builds with an Imcando hammer wielded in either hand; without a hammer the recorded tool line", (t) => {
  let interact = null;
  const real = PM.createApi("StashHammerTest");
  Stash(new Proxy(real, { get: (target, key) => (key === "onBeforeObjectInteraction" ? (handler) => { interact = handler; } : target[key]) }));
  const [locId] = [...Stash.stashes()].find(([, entry]) => entry.tier.name === "easy");
  const actorWith = (materials = true) => {
    const f = actor(t);
    f.p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false).setCurrentLevels(core.Skill.CONSTRUCTION, 99, false);
    f.inv.add(new core.Item(I.SAW, 1));
    if (materials) {
      f.inv.add(new core.Item(I.PLANK, 2));
      f.inv.add(new core.Item(I.BRONZE_NAILS, 10));
    }
    const spam = [];
    t.mock.method(f.p.getPacketSender(), "sendTypedMessage", (_type, message) => { spam.push(message); return f.p.getPacketSender(); });
    return { ...f, spam };
  };
  const built = (f) => (f.p.getAttribute(Stash.BUILT_ATTRIBUTE) ?? []).includes(locId);
  for (const [slot, hammerId] of [[core.Equipment.WEAPON_SLOT, I.IMCANDO_HAMMER], [core.Equipment.SHIELD_SLOT, I.IMCANDO_HAMMER_OFF_HAND_]]) {
    const f = actorWith();
    f.p.getEquipment().set(slot, new core.Item(hammerId, 1));
    interact({ player: f.p, objectId: locId, handled: false });
    assert.equal(built(f), true, `built with ${hammerId} wielded`);
    assert.deepEqual(f.spam, ["You build a STASH unit."]);
    assert.equal(f.inv.getAmount(I.PLANK), 0, "the planks are used");
  }
  const noHammer = actorWith();
  interact({ player: noHammer.p, objectId: locId, handled: false });
  assert.equal(built(noHammer), false);
  assert.equal(noHammer.messages.at(-1), "You need a saw and a hammer in order to build a STASH unit here.");
  assert.equal(noHammer.inv.getAmount(I.PLANK), 2, "nothing used");
  const noPlanks = actorWith(false);
  noPlanks.inv.add(new core.Item(I.HAMMER, 1));
  interact({ player: noPlanks.p, objectId: locId, handled: false });
  assert.equal(built(noPlanks), false);
  assert.equal(noPlanks.messages.at(-1), "You do not have the required materials to build a STASH unit here.");
});
