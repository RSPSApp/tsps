// Run after `yarn build`: node --test tests/settings-confirmations.test.cjs
// All Settings confirmations and messages: the clue scroll warnings (374-379), STASH units taking worn items (451),
// the Plank Make confirmations (420-423), the gravestone fee confirmation (192) and the warning before a teleport
// spell leaves your boat at sea (471). Each acts only while its row is on, and nothing is taken until the player
// says yes. Real engine: every plugin loaded and a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const settingsJson = require("../plugins/interface/data/settings.json").settings;
const Capacity = require("../plugins/treasuretrails/Capacity.ClueCapacity");
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const Grave = require("../plugins/world/gravestones/Grave.Gravestones");
const GraveInterface = require("../plugins/world/gravestones/Interface.Gravestones");
const TeleportWarning = require("../plugins/skills/sailing/TeleportWarning.Sailing");

let core;
let I;
let next = 9870;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.createApi("SettingsConfirmationsDreamMentor").onCustomEvent("quest:is-complete", (q) => { if (q.key === "dream_mentor") q.complete = true; });
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("confirm" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages, varbit: (id, value) => p.getPacketSender().sendVarbit(id, value) };
}

const choose = (player, option) => MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: option });

// ---------------------------------------------------------------- the rows and their vars

/** The first instructions of All Settings' toggle reader (script 6716) for one setting id. */
function toggleReaderCase(settingId) {
  const data = Buffer.from(CacheIndexDat2.fromStore(12, CachePipeline.getStore()).getArchive(6716).getFile(0).data);
  const switchLength = data.readUInt16BE(data.length - 2);
  const end = data.length - 2 - switchLength - 16;
  let at = end + 16;
  const switches = [];
  for (let i = 0, n = data[at++]; i < n; i++) {
    const cases = new Map();
    for (let count = data.readUInt16BE(at), k = (at += 2, 0); k < count; k++, at += 8) cases.set(data.readInt32BE(at), data.readInt32BE(at + 4));
    switches.push(cases);
  }
  const ops = [];
  const operands = [];
  at = data.indexOf(0) + 1;
  while (at < end) {
    const op = data.readUInt16BE(at);
    at += 2;
    let operand = 0;
    if (op === 3) at = data.indexOf(0, at) + 1;
    else if (op === 61) at += 8;
    else if (op === 21 || op === 38 || op === 39 || op === 62 || op === 63 || op >= 100) operand = data[at++];
    else { operand = data.readInt32BE(at); at += 4; }
    ops.push(op);
    operands.push(operand);
  }
  const pc = ops.indexOf(60);
  const start = pc + switches[operands[pc]].get(settingId) + 1;
  return ops.slice(start, start + 3).map((op, i) => [op, operands[start + i]]);
}

test("each row names the varbit the cache's setting reader returns, with live's default", () => {
  const PUSH_VARBIT = 25, RETURN = 21;
  // Live defaults: every default-state login (rev 235+) in the rsprox captures sends 192's and 205's varbit as 1.
  const rows = { 192: [13113, 1], 205: [13130, 1], 374: [10693], 375: [10694], 376: [10695], 377: [10723], 378: [10724],
    379: [10725], 420: [624, 1], 421: [2319], 422: [2320], 423: [3939, 1], 451: [17938], 471: [16620] };
  for (const [id, [varbit, value]] of Object.entries(rows)) {
    assert.deepEqual(toggleReaderCase(Number(id)).slice(0, 2), [[PUSH_VARBIT, varbit], [RETURN, 0]], `row ${id} reads varbit ${varbit}`);
    assert.equal(settingsJson[id].varbit, varbit, `row ${id} in settings.json`);
    assert.equal(settingsJson[id].default, value, `row ${id} default`);
  }
  // 278 shows the inverse of option_item_retrieval_warning_disabled, so it no longer shares 192's varbit.
  assert.deepEqual(toggleReaderCase(278).slice(0, 2), [[0, 1], [PUSH_VARBIT, 14194]]);
  assert.equal(settingsJson[278].varbit, 14194);
});

// ---------------------------------------------------------------- 10a: treasure trails

test("a clue dropped at capacity is mentioned only with its tier's warning on", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  for (const [tier, line] of [["beginner", "a beginner clue scroll"], ["easy", "an easy clue scroll"], ["elite", "an elite clue scroll"]]) {
    const f = actor(t);
    const clue = I[`CLUE_SCROLL_${tier.toUpperCase()}_`];
    f.inv.adds(clue, 1);
    const drop = () => {
      const request = { player: f.p, drops: [{ itemId: clue, amount: 1 }, { itemId: I.COINS, amount: 5 }, { itemId: clue, amount: 1 }] };
      Capacity.filterDrops(request);
      assert.deepEqual(request.drops.map((d) => d.itemId), [I.COINS], "the clue is never dropped");
    };
    drop();
    assert.deepEqual(f.messages, [], `${tier}: off by default`);
    f.varbit(Capacity.WARNING_VARBITS[tier], 1);
    drop();
    assert.deepEqual(f.messages, [`You have a sneaking suspicion that you would have received ${line}.`], "once per roll");
  }
});

test("a clue with room left is dropped with no message", (t) => {
  const f = actor(t);
  f.varbit(Capacity.WARNING_VARBITS.beginner, 1);
  const request = { player: f.p, drops: [{ itemId: I.CLUE_SCROLL_BEGINNER_, amount: 1 }] };
  Capacity.filterDrops(request);
  assert.equal(request.drops.length, 1);
  assert.deepEqual(f.messages, []);
});

/** The unit's own handler, and a built unit whose step names explicit wearable items. */
function stashUnit(f) {
  let interact = null;
  const real = PM.createApi("SettingsConfirmationsStash");
  Stash(new Proxy(real, { get: (target, key) => (key === "onBeforeObjectInteraction" ? (handler) => { interact = handler; } : target[key]) }));
  for (const [locId, unit] of Stash.stashes()) {
    const needs = unit.step.equipment.filter((requirement) => requirement.emptySlot == null);
    const ids = needs.map((requirement) => requirement.anyOf?.[0]);
    const slots = ids.map((id) => id != null && core.ItemDefinition.forId(id).getEquipmentType?.()?.getSlot?.());
    if (needs.length > 1 && slots.every((slot) => Number.isInteger(slot) && slot >= 0) && new Set(slots).size === slots.length) {
      f.p.setAttribute(Stash.BUILT_ATTRIBUTE, [locId]);
      return { use: () => interact({ player: f.p, objectId: locId, handled: false }), ids, slots, locId };
    }
  }
  throw new Error("no STASH unit with explicit wearable items");
}

test("a STASH unit takes worn items only with 'STASH units take equipped items' on, the inventory first", (t) => {
  const f = actor(t);
  const unit = stashUnit(f);
  const equipment = f.p.getEquipment();
  const bonusUpdates = [];
  t.mock.method(core.BonusManager, "update", (player) => { bonusUpdates.push(player); });
  // The first item is worn and also held; the rest are worn only.
  unit.ids.forEach((id, i) => equipment.setItem(unit.slots[i], new core.Item(id, 1)));
  f.inv.adds(unit.ids[0], 1);
  unit.use();
  assert.equal(f.messages.at(-1), "You need all the items for this STASH unit's emote clue to store them.");
  assert.equal(f.p.getAttribute(Stash.STORED_ATTRIBUTE)?.[unit.locId], undefined, "off: nothing stored");

  f.varbit(17938, 1);
  unit.use();
  assert.equal(f.messages.at(-1), "You store the items in the STASH unit.");
  assert.deepEqual(f.p.getAttribute(Stash.STORED_ATTRIBUTE)[unit.locId], unit.ids);
  assert.equal(f.inv.getAmount(unit.ids[0]), 0, "the held copy went in");
  assert.equal(equipment.getItems()[unit.slots[0]]?.getId(), unit.ids[0], "and the worn copy stayed on");
  unit.slots.slice(1).forEach((slot) => assert.ok(!(equipment.getItems()[slot]?.getAmount() > 0), "the worn-only items went in"));
  assert.equal(bonusUpdates.length, 1, "the worn items' bonuses are recomputed");
});

// ---------------------------------------------------------------- 10b: Plank Make and the gravestone fee

/** A Lunar caster: Lunar spells need 40 Defence. */
function lunar(f) {
  f.p.getSkillManager().setMaxLevel(core.Skill.DEFENCE, 40);
  return f;
}

const castable = (run) => {
  const original = Spell.prototype.canCast;
  Spell.prototype.canCast = () => true;
  try { return run(); } finally { Spell.prototype.canCast = original; }
};

test("Plank Make asks before taking coins for a log type whose confirmation is on, and takes nothing on no", (t) => {
  const f = lunar(actor(t));
  f.inv.adds(I.COINS, 1000);
  f.inv.adds(I.LOGS, 1);
  f.varbit(624, 1);
  const cast = () => castable(() => LunarSpells.handleItemTarget(f.p, I.LOGS, f.inv.getSlotForItemId(I.LOGS), "Plank Make"));
  cast();
  assert.equal(f.p.getDialogueManager().isActive(), true, "the question is up");
  assert.equal(f.inv.getAmount(I.COINS), 1000, "no coins yet");
  assert.equal(f.inv.getAmount(I.LOGS), 1);
  castable(() => f.p.getDialogueManager().handleOption(2));
  assert.equal(f.inv.getAmount(I.COINS), 1000, "no: nothing taken");
  assert.equal(f.inv.getAmount(I.LOGS), 1);

  cast();
  castable(() => f.p.getDialogueManager().handleOption(1));
  assert.equal(f.inv.getAmount(I.COINS), 930, "yes: 70 coins");
  assert.equal(f.inv.getAmount(I.PLANK), 1);
  assert.equal(f.inv.getAmount(I.LOGS), 0);
});

test("Plank Make with the log type's confirmation off converts straight away", (t) => {
  const f = lunar(actor(t));
  f.inv.adds(I.COINS, 1000);
  f.inv.adds(I.OAK_LOGS, 1);
  f.varbit(624, 1); // basic logs' row says nothing about oak
  castable(() => LunarSpells.handleItemTarget(f.p, I.OAK_LOGS, f.inv.getSlotForItemId(I.OAK_LOGS), "Plank Make"));
  assert.equal(f.inv.getAmount(I.COINS), 825);
  assert.equal(f.inv.getAmount(I.OAK_PLANK), 1);
});

function graveScene(t, owed) {
  const f = actor(t);
  const npc = { getLocation: () => new core.Location(3202, 3200, 0) };
  let open = true;
  const paid = [];
  t.mock.method(Grave, "isOpen", () => open);
  t.mock.method(Grave, "open", () => { open = true; });
  t.mock.method(Grave, "fee", () => owed.value);
  t.mock.method(Grave, "npcOf", () => npc);
  t.mock.method(Grave, "payOrTake", (player) => { paid.push(player); owed.value = 0; });
  t.mock.method(f.p.getPacketSender(), "sendInterfaceRemoval", () => { open = false; return f.p.getPacketSender(); });
  return { ...f, paid, isOpen: () => open };
}

test("the gravestone fee is paid only on yes when its confirmation is on", (t) => {
  const owed = { value: 15000 };
  const f = graveScene(t, owed);
  f.varbit(GraveInterface.PAY_CONFIRM_VARBIT, 1);
  GraveInterface.pay({ player: f.p });
  assert.deepEqual(f.paid, [], "asked first");
  assert.equal(MultiChatboxPrompt.getPending(f.p)?.title, "Pay 15,000 coins to retrieve your items?");
  choose(f.p, 2);
  assert.deepEqual(f.paid, [], "no: nothing paid");
  assert.equal(f.isOpen(), true, "no: the grave's interface is back");

  GraveInterface.pay({ player: f.p });
  choose(f.p, 1);
  assert.equal(f.paid.length, 1, "yes: paid once");
  assert.equal(f.isOpen(), true, "the grave's interface is back");
});

test("the gravestone fee is not paid on a late yes from out of reach, or after the fee changed", (t) => {
  const owed = { value: 15000 };
  const f = graveScene(t, owed);
  f.varbit(GraveInterface.PAY_CONFIRM_VARBIT, 1);
  GraveInterface.pay({ player: f.p });
  f.p.setLocation(new core.Location(3220, 3200, 0));
  choose(f.p, 1);
  assert.deepEqual(f.paid, []);
  f.p.setLocation(new core.Location(3200, 3200, 0));
  GraveInterface.pay({ player: f.p });
  owed.value = 20000;
  choose(f.p, 1);
  assert.deepEqual(f.paid, []);
});

test("with the gravestone confirmation off, or no fee owed, the pay button acts at once", (t) => {
  const owed = { value: 15000 };
  const f = graveScene(t, owed);
  GraveInterface.pay({ player: f.p });
  assert.equal(f.paid.length, 1, "off: paid at once");
  f.varbit(GraveInterface.PAY_CONFIRM_VARBIT, 1);
  GraveInterface.pay({ player: f.p });
  assert.equal(f.paid.length, 2, "nothing owed: the paid items are taken at once");
  assert.equal(MultiChatboxPrompt.getPending(f.p), null);
});

// ---------------------------------------------------------------- 10c: teleporting off your boat

function teleportRequest(f) {
  const request = { player: f.p, name: "varrock teleport", handled: false, cast: 0 };
  request.proceed = () => { request.cast++; };
  return request;
}

test("a teleport spell aboard your own boat asks first with the warning on, and casts on yes only", (t) => {
  const f = actor(t);
  let aboard = {};
  t.mock.method(core.Sailing, "instanceAboard", () => aboard);
  f.varbit(TeleportWarning.WARNING_VARBIT, 1);
  const ask = () => {
    const request = teleportRequest(f);
    PM.emitCustomEvent("spell:teleport-confirm", request);
    if (!request.handled) request.proceed();
    return request;
  };
  let request = ask();
  assert.equal(request.cast, 0);
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p), { title: TeleportWarning.QUESTION, options: [TeleportWarning.YES, TeleportWarning.NO] });
  choose(f.p, 2);
  assert.equal(request.cast, 0, "no: stays aboard");
  request = ask();
  choose(f.p, 1);
  assert.equal(request.cast, 1, "yes: the teleport goes ahead");

  aboard = undefined;
  request = ask();
  assert.equal(request.cast, 1, "not aboard: no warning");
});

test("with the boat teleport warning off, a teleport spell aboard casts at once", (t) => {
  const f = actor(t);
  t.mock.method(core.Sailing, "instanceAboard", () => ({}));
  const request = teleportRequest(f);
  PM.emitCustomEvent("spell:teleport-confirm", request);
  if (!request.handled) request.proceed();
  assert.equal(request.cast, 1);
});

test("the boat warning follows a Wilderness warning the spell also has", (t) => {
  const f = actor(t);
  t.mock.method(core.Sailing, "instanceAboard", () => ({}));
  f.varbit(TeleportWarning.WARNING_VARBIT, 1);
  const request = teleportRequest(f);
  request.name = "ghorrock teleport";
  f.varbit(core.CacheDefinitions.getVarbitId("ghorrock_teleport_warning"), 1);
  PM.emitCustomEvent("spell:teleport-confirm", request);
  assert.equal(request.handled, true, "the Wilderness warning asks");
  assert.notEqual(MultiChatboxPrompt.getPending(f.p)?.title, TeleportWarning.QUESTION);
  choose(f.p, 1);
  assert.equal(MultiChatboxPrompt.getPending(f.p)?.title, TeleportWarning.QUESTION, "then the boat warning");
  choose(f.p, 1);
  assert.equal(request.cast, 1);
});

// ---------------------------------------------------------------- row 278's old varbit

test("a 13113 saved by row 278 before is dropped once at login, so 192 starts at its default", () => {
  const Settings = require("../plugins/interface/Settings.plugin");
  let restoreSettings;
  const api = { core, onPlayerLogin: (fn) => { if (fn.name === "restoreSettings") restoreSettings = fn; }, emitCustomEvent: () => {} };
  Settings.register(new Proxy(api, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const varbits = new Map();
  const attributes = new Map([["settings:values", { "varbit:13113": 0, "varbit:10693": 1 }]]);
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarp: () => 0, sendConfig() { return sender; }, sendClientScript() { return sender; },
  };
  const player = { getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v), getPacketSender: () => sender };
  restoreSettings({ player });
  assert.equal(varbits.get(13113), 1, "192's default, not the old 278 value");
  assert.deepEqual(attributes.get("settings:values"), { "varbit:10693": 1 }, "only the stale key goes");
  // Once migrated, a 192 choice made since is kept.
  attributes.set("settings:values", { "varbit:13113": 0 });
  restoreSettings({ player });
  assert.equal(varbits.get(13113), 0);
});
