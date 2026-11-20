// From server/ after `yarn build`: node --test tests/qh728-q061.test.cjs
//
// In Aid of the Myreque regression contracts (QH728 Q061), on the rebuilt quest (live's stages and
// varbits, ../plugins/quests/inaid/). Real plugins, a real Player; clicks, talks and casts go through
// PluginManager, ticks through TaskManager. The per-unit tests (in-aid-of-the-myreque-{burgh,store,
// tithe,escort,rod}.test.cjs) pin the live capture's details; this file keeps the older regressions
// and one end-to-end walk.
//
// Ported from the pre-capture version: every one of its 17 contracts is kept, none dropped. What
// changed is how each is reached: the old route dispatched transcript step ids (QvHBD5, JHVR_s,
// EEIDrs, h2dEwU, ...) against runtime GameObjects, the full-crate item 7631 and the old stage numbers
// (50, 120, 320 -> 350, completion 420). Those were replaced by live's: Inspect/"Fix ...?" Yes. on the
// cache multilocs (store test), the 7630 crate with varbits 1991-1993 (store test), the castle scene,
// store fight and swamp ambush instances (tithe and escort tests) and live's stage values
// (State.InAidOfTheMyreque.js), so the tests below drive those handlers instead.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const runtime = require("../plugins/quests/QuestRuntime");
const { STAGE, VARBIT, impliedVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");

// Record which transcript page/variant each handler plays; the real startTranscript still runs. Patched
// before the plugins load, so the units' destructured copies are this wrapper.
let transcripts = [];
const startTranscript = runtime.startTranscript;
runtime.startTranscript = (...args) => {
  transcripts.push({ npcId: args[2], page: args[3], variant: args[4] });
  return startTranscript(...args);
};

const STAGE_KEY = "quest.in_aid_of_the_myreque.stage";
const PAGE = "In Aid of the Myreque";
let core, I, N;
let next = 9400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3508, 9838], [3484, 3245], [3514, 3240], [3527, 3209], [3553, 3337], [3572, 3331], [2859, 4554],
    [3432, 3484], [3440, 9895], [3360, 9904], [3429, 3401], [3483, 9832], [3494, 9628]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const players = new Set();

/** A logged-in player at `stage` with the varbits live had by then (or a raw legacy save with `legacy`). */
function actor(t, stage, at, { vars = {}, legacy = false, prerequisites = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername(`q061p${next}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  if (!legacy) {
    p.setAttribute(SAVE_VERSION_ATTRIBUTE, 2);
    p.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(stage), ...vars });
  }
  p.setAttribute(STAGE_KEY, stage);
  if (prerequisites) meetRequirements(p);
  const seen = { messages: [], varbits: [], chatbox: [] };
  const sender = p.getPacketSender();
  for (const [method, record] of [
    ["sendVarbit", (id, value) => seen.varbits.push([id, value])],
    ["sendChatboxInterface", (group) => seen.chatbox.push(group)],
  ]) {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  }
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  players.add(p);
  const npcs = [];
  t.after(() => {
    p.getDialogueManager().reset?.();
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    players.delete(p);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const npc of npcs) core.World.getNpcs().remove(npc);
  });
  const spawn = (id, tile) => {
    const npc = core.NPC.create(id, new core.Location(...tile));
    core.World.getNpcs().add(npc);
    npcs.push(npc);
    return npc;
  };
  return { p, seen, spawn };
}

function meetRequirements(p, quests = ["in_search_of_the_myreque", "nature_spirit", "priest_in_peril", "the_restless_ghost"]) {
  for (const key of quests) p.setAttribute(`quest.${key}.stage`, 1000);
  for (const skill of [core.Skill.CRAFTING, core.Skill.MINING, core.Skill.MAGIC, core.Skill.AGILITY]) {
    p.getSkillManager().setMaxLevel(skill, 99).setCurrentLevel(skill, 99);
  }
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const p of players) {
      AreaManager.process(p);
      p.getMovementQueue().process();
      core.TaskManager.processWalkTo(p.getIndex());
    }
    core.TaskManager.process();
    for (const p of players) p.resetUpdating();
  }
}

const stageOf = (p) => Number(p.getAttribute(STAGE_KEY)) || 0;
const varbit = (p, id) => Number(p.getAttribute(VARS_ATTRIBUTE)?.[id]) || 0;
const amount = (p, id) => p.getInventory().getAmount(id);
const tile = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const menu = (p) => core.MultiChatboxPrompt.getPending(p);
const current = (p) => p.getDialogueManager().getCurrent();
const text = (p) => String(current(p)?.getText?.() ?? "").replace(/<br>/g, " ").replace(/\s+/g, " ").trim();
const cont = (p) => p.getDialogueManager().advance();
const complete = (p, key = "in_aid_of_the_myreque") => {
  const request = { player: p, key, complete: null };
  PM.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
};
const played = (page, variant) => transcripts.some((call) => call.page === page && (variant === undefined || call.variant === variant));

function choose(p, option) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${option}" (showing "${text(p)}")`);
  const at = pending.options.findIndex((entry) => entry.startsWith(option));
  assert.ok(at >= 0, `"${option}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: at + 1 });
}

/** Continues (and ticks through held boxes) until a line or menu option starts with `prefix`. */
function until(p, prefix, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const pending = menu(p);
    if (pending?.options?.some((entry) => entry.startsWith(prefix)) || pending?.title?.startsWith?.(prefix)) return;
    if (text(p).startsWith(prefix)) return;
    if (pending) assert.fail(`menu [${pending.options.join(" | ")}] while waiting for "${prefix}"`);
    if (current(p) && current(p).isSelfAdvancing?.() !== true) cont(p);
    else tick();
  }
  assert.fail(`"${prefix}" never showed (last "${text(p)}")`);
}

/** Continues until the conversation ends or a menu opens. */
function finish(p, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    if (!current(p)) { tick(); if (!current(p) && !menu(p)) return; continue; }
    if (current(p).isSelfAdvancing?.() === true) tick();
    else cont(p);
  }
}

function talk(p, npc, option = "Talk-to") {
  const definition = npc.getCurrentDefinition?.(p) ?? npc.getDefinition();
  const clickType = definition.getActions().findIndex((op) => op === option) + 1;
  return PM.emitNpcInteraction({ player: p, npc, npcId: npc.getContentId?.(p) ?? definition.getId(), npcIndex: npc.getIndex(), definition,
    clickType, action: option, location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() }, handled: false });
}

function fakeObject(id, [x, y, z]) {
  return { getId: () => id, getLocation: () => new core.Location(x, y, z), getPrivateArea: () => null, getType: () => 10, getFace: () => 0,
    getDefinition: () => core.ObjectDefinition.forId(id) };
}

function click(p, id, option, at, object = fakeObject(id, at)) {
  const definition = core.ObjectDefinition.forPlayer(id, p) ?? core.ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((op) => op === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} (${id}) has ${option}`);
  const [x, y, z] = at;
  return PM.emitObjectInteraction({ player: p, object, objectId: id, definition, clickType, option, location: { x, y, z },
    sourceLocation: { x: p.getLocation().getX(), y: p.getLocation().getY(), z: p.getLocation().getZ() }, handled: false });
}

function useOn(p, itemId, id, at, object = fakeObject(id, at)) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const [x, y, z] = at;
  return PM.emitItemOnObject({ player: p, object, definition: core.ObjectDefinition.forPlayer(id, p) ?? undefined, objectId: id,
    item: p.getInventory().getItems()[slot], itemId, itemSlot: slot, interfaceType: 0, location: { x, y, z }, handled: false });
}

function useOnItem(p, usedId, withId) {
  const items = p.getInventory().getItems();
  const used = items.findIndex((item) => item?.getId() === usedId);
  const target = items.findIndex((item) => item?.getId() === withId);
  return PM.emitItemOnItem({ player: p, usedItem: items[used], usedItemId: usedId, usedItemSlot: used,
    usedWithItem: items[target], usedWithItemId: withId, usedWithItemSlot: target, handled: false });
}

function useOnNpc(p, npc, itemId) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const definition = npc.getCurrentDefinition(p);
  return PM.emitItemOnNpc({ player: p, target: npc, definition, npcId: definition.getId(), targetIndex: npc.getIndex(),
    item: p.getInventory().getItems()[slot], itemId, slot, interfaceId: 149 << 16, handled: false });
}

function itemOption(p, itemId, option) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const action = [1, 2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op)).find((a) => a?.option === option);
  assert.ok(action, `item ${itemId} has ${option}`);
  return PM.emitItemAction({ player: p, item: p.getInventory().getItems()[slot], itemId, slot, interfaceId: 149 << 16,
    clickType: action.optionIndex, option: action.option, handled: false });
}

function castEnchant(p, itemId) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  return PM.emitSpellOnItem({ player: p, spellName: "Lvl-1 Enchant", spellWidget: 0, spellItemId: -1, itemId, slot, handled: false });
}

function give(p, itemId, count = 1) {
  const definition = core.ItemDefinition.forId(itemId);
  if (definition?.isStackable?.() || definition?.isNoted?.() || count === 1) return p.getInventory().add(new core.Item(itemId, count));
  for (let i = 0; i < count; i++) p.getInventory().add(new core.Item(itemId, 1));
}

const fill = (p, slots) => { for (let i = 0; i < slots; i++) p.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1)); };
const ownedNpcs = (p, id) => [...core.World.getNpcs()].filter((npc) => npc?.isRegistered?.() && npc.getOwner?.() === p && (id === undefined || npc.getContentId(p) === id || npc.getId() === id));

const HIDEOUT = [3508, 9838, 0];
const MAUSOLEUM = [3440, 9895, 0];
const BURGH_STORE = [3515, 3238, 0];

// ---------------------------------------------------------------------------
// Saves and other quests
// ---------------------------------------------------------------------------

test("old completed saves (stage 420) replay as varbit 1990 = 430 after the login migration and count as complete", (t) => {
  const { p, seen } = actor(t, 420, [3494, 9630, 0], { legacy: true });
  assert.equal(stageOf(p), STAGE.COMPLETE, "420 migrates to 430");
  assert.equal(Number(p.getAttribute(SAVE_VERSION_ATTRIBUTE)), 2);
  assert.ok(seen.varbits.some(([id, value]) => id === VARBIT.QUEST && value === 430), "login sends 1990 = 430");
  assert.equal(varbit(p, VARBIT.TEMPLE_TREK_NPCS), 1, "the completion varbits are implied");
  assert.equal(complete(p), true);

  // A mid-quest legacy save moves onto live's stage for the same point (old 50 "Razvan points at the inn" -> 60).
  const mid = actor(t, 50, [3484, 3242, 0], { legacy: true });
  assert.equal(stageOf(mid.p), STAGE.TOLD_INN);
  assert.ok(mid.seen.varbits.some(([id, value]) => id === VARBIT.QUEST && value === STAGE.TOLD_INN));
  assert.equal(complete(mid.p), false);
});

test("completed In Aid yields Veliaf to A Taste of Hope's rod step", (t) => {
  const { p, seen } = actor(t, STAGE.COMPLETE, [3494, 9630, 0]);
  const veliaf = new core.NPC(8277, new core.Location(3494, 9628, 0));
  assert.equal(veliaf.getContentId(p), N.VELIAF_HURTZ_3, "the Burgh de Rott hideout's Veliaf");
  // A Taste of Hope at its rod step: Veliaf was asked for a rod and none is held or claimed yet.
  p.setAttribute("quest.taste_of_hope.stage", 120);
  p.setAttribute("quest.taste_of_hope.bits", 1 << 13);
  const asked = { player: p, needsRod: null };
  PM.emitCustomEvent("taste-of-hope:needs-veliaf-rod", asked);
  assert.equal(asked.needsRod, true, "Taste's public answer");
  transcripts = [];
  talk(p, veliaf);
  assert.ok(!played(PAGE), "In Aid's post-quest talk does not take Veliaf while Taste needs the rod");
  assert.equal(seen.messages.length, 0, "nor does the next quest's start");
  p.getDialogueManager().reset();

  // Once the rod is claimed, the quests after In Aid have Veliaf again (Darkness of Hallowvale is
  // registered ahead of In Aid's greeting; here it refuses its start on requirements).
  p.setAttribute("quest.taste_of_hope.bits", (1 << 13) | (1 << 14));
  transcripts = [];
  assert.equal(talk(p, veliaf), true, "Veliaf is talkable once Taste has its rod");
});

test("missing The Restless Ghost blocks the start", (t) => {
  const { p, seen, spawn } = actor(t, 0, HIDEOUT, { prerequisites: false });
  meetRequirements(p, ["in_search_of_the_myreque", "nature_spirit", "priest_in_peril"]);
  talk(p, spawn(9620, [3506, 9838, 0]));
  finish(p);
  assert.equal(stageOf(p), 0);
  assert.ok(seen.messages.some((message) => message.includes("The Restless Ghost")), JSON.stringify(seen.messages));
  assert.ok(!seen.messages.some((message) => message.includes("Nature Spirit")), "only the missing quest is named");
});

// ---------------------------------------------------------------------------
// Burgh de Rott: the inn
// ---------------------------------------------------------------------------

test("out-of-order rubble work cannot skip the Veliaf/Florin/broken-wall start", (t) => {
  for (const stage of [0, STAGE.STARTED, STAGE.TOLD_INN]) {
    const { p } = actor(t, stage, [3491, 3231, 0]);
    give(p, I.RUNE_PICKAXE);
    useOn(p, I.RUNE_PICKAXE, 12738, [3489, 3231, 0]);
    tick(5);
    assert.equal(stageOf(p), stage, `a pickaxe on the collapsed wall at ${stage} does nothing`);
    assert.equal(varbit(p, VARBIT.INN_WALL), 0);
  }
  const { p } = actor(t, STAGE.WALL_CLIMBED, [3491, 3231, 0]);
  give(p, I.RUNE_PICKAXE);
  assert.equal(useOn(p, I.RUNE_PICKAXE, 12738, [3489, 3231, 0]), true);
  tick(4);
  assert.equal(stageOf(p), STAGE.RUBBLE_MINED, "after the wall is climbed (70) the rubble breaks");
});

test("a pickaxe above the Mining level gets the level line at the inn rubble; none at all the rubble line", (t) => {
  const { p, seen } = actor(t, STAGE.WALL_CLIMBED, [3491, 3231, 0]);
  p.getSkillManager().setMaxLevel(core.Skill.MINING, 1).setCurrentLevel(core.Skill.MINING, 1);
  give(p, I.DRAGON_PICKAXE);
  useOn(p, I.DRAGON_PICKAXE, 12738, [3489, 3231, 0]);
  assert.equal(seen.messages.at(-1), "You do not have a pickaxe which you have the Mining level to use.");
  tick(5);
  assert.equal(stageOf(p), STAGE.WALL_CLIMBED, "nothing mined");
  // The cellar rubble: no pickaxe at all, then one above the level.
  const cellar = actor(t, STAGE.TRAPDOOR_OPEN, [3491, 3232, 0]);
  cellar.p.getSkillManager().setMaxLevel(core.Skill.MINING, 1).setCurrentLevel(core.Skill.MINING, 1);
  click(cellar.p, 12743, "Climb-down", [3490, 3232, 0]);
  tick();
  const rubble = (cellar.p.getPrivateArea?.()?.getObjects?.() ?? []).find((object) => object.getId() === 12812);
  assert.ok(rubble, "the cellar's rubble");
  const at = [rubble.getLocation().getX(), rubble.getLocation().getY(), rubble.getLocation().getZ()];
  click(cellar.p, 12812, "Mine", at, rubble);
  assert.equal(cellar.seen.messages.at(-1), "You need a pickaxe to clear this rubble.");
  give(cellar.p, I.DRAGON_PICKAXE);
  click(cellar.p, 12812, "Mine", at, rubble);
  assert.equal(cellar.seen.messages.at(-1), "You do not have a pickaxe which you have the Mining level to use.", "the cellar rubble too");
  cellar.p.getInventory().delete(new core.Item(I.DRAGON_PICKAXE, 1));
  cellar.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.DRAGON_PICKAXE, 1));
  cellar.seen.messages.length = 0;
  click(cellar.p, 12812, "Mine", at, rubble);
  assert.equal(cellar.seen.messages.at(-1), "You do not have a pickaxe which you have the Mining level to use.", "a wielded one counts");
  tick(10);
  assert.equal(varbit(cellar.p, VARBIT.RUBBLE_MESSAGE), 0, "nothing mined");
});

// ---------------------------------------------------------------------------
// Burgh de Rott: the store
// ---------------------------------------------------------------------------

test("the crate accepts raw snails and cooked snail meat together, and fills to 10", (t) => {
  const { p } = actor(t, STAGE.CRATE_GIVEN, BURGH_STORE);
  p.setAttribute("in-aid-of-the-myreque:crate-food", 1); // Aurel asked for snails
  give(p, I.CRATE);
  give(p, I.THIN_SNAIL, 6);
  give(p, I.FAT_SNAIL_MEAT, 6);
  useOnItem(p, I.THIN_SNAIL, I.CRATE);
  choose(p, "Yes, I'll fill the crate.");
  p.getDialogueManager().reset();
  // "10 snails of any type": the fill takes raw snails and cooked meat alike, 10 in all.
  assert.equal(varbit(p, VARBIT.CRATE_FOOD), 10, "raw and cooked fill the food side");
  assert.equal(amount(p, I.THIN_SNAIL) + amount(p, I.FAT_SNAIL_MEAT), 2, "only the 10 needed go");
  assert.ok(amount(p, I.THIN_SNAIL) < 6 && amount(p, I.FAT_SNAIL_MEAT) < 6, "both kinds were taken");
  assert.equal(amount(p, I.CRATE), 1, "still the 7630 crate");
});

test("a lost crate is replaced by Aurel's 'What should I do now?', its packed stock kept, and is not duplicated", (t) => {
  const { p, spawn } = actor(t, STAGE.CRATE_GIVEN, BURGH_STORE, { vars: { [VARBIT.CRATE_AXES]: 10 } });
  p.setAttribute("in-aid-of-the-myreque:crate-food", 1);
  const aurel = spawn(N.AUREL, [3516, 3238, 0]);
  talk(p, aurel);
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  finish(p);
  assert.equal(amount(p, I.CRATE), 1, "a crate again");
  assert.equal(varbit(p, VARBIT.CRATE_AXES), 10, "what was packed stays packed (varbits 1991-1993, not the item)");
  assert.equal(stageOf(p), STAGE.CRATE_GIVEN, "the stage does not change");
  p.getDialogueManager().reset();
  talk(p, aurel);
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  finish(p);
  assert.equal(amount(p, I.CRATE), 1, "a held crate is not duplicated");
  p.getInventory().deleteNumber(I.CRATE, 1);
  p.getBank(0).add(new core.Item(I.CRATE, 1));
  p.getDialogueManager().reset();
  talk(p, aurel);
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  finish(p);
  assert.equal(amount(p, I.CRATE), 0, "a banked crate is not duplicated either");
});

// ---------------------------------------------------------------------------
// The blood tithe: the Gadderhammer and Aurel afterwards
// ---------------------------------------------------------------------------

test("a lost Gadderhammer: Aurel's recovery page sells it back for 3,000 coins", (t) => {
  const { p, spawn } = actor(t, STAGE.GADDERANKS_DEAD, [3516, 3241, 0]);
  const aurel = spawn(N.AUREL, [3517, 3241, 0]);
  transcripts = [];
  talk(p, aurel);
  assert.ok(played("Aurel", "if-the-player-has-lost-the-gadderhammer"), "the lost-hammer page");
  until(p, "I've lost Gadderanks' Warhammer.");
  choose(p, "I've lost Gadderanks' Warhammer.");
  finish(p);
  assert.equal(amount(p, I.GADDERHAMMER), 0, "no coins, no hammer");
  p.getDialogueManager().reset();

  give(p, I.COINS, 3000);
  talk(p, aurel);
  until(p, "I've lost Gadderanks' Warhammer.");
  choose(p, "I've lost Gadderanks' Warhammer.");
  for (let i = 0; i < 20 && amount(p, I.GADDERHAMMER) === 0; i++) {
    if (menu(p)) choose(p, menu(p).options.find((option) => /^Yes/.test(option)) ?? menu(p).options[0]);
    else if (current(p)) cont(p);
    else tick();
  }
  assert.equal(amount(p, I.GADDERHAMMER), 1, "the hammer is bought back");
  assert.equal(amount(p, I.COINS), 0, "for 3,000 coins");
});

test("Aurel's post-quest standard page is used when the hammer is held", (t) => {
  const { p, spawn } = actor(t, STAGE.COMPLETE, [3516, 3241, 0]);
  give(p, I.GADDERHAMMER);
  transcripts = [];
  assert.equal(talk(p, spawn(N.AUREL, [3517, 3241, 0])), true);
  assert.ok(played("Aurel", "standard-dialogue"), JSON.stringify(transcripts));
  assert.ok(!played(PAGE), "not a quest page");
});

// ---------------------------------------------------------------------------
// Paterdomus: Drezel's library key
// ---------------------------------------------------------------------------

function drezel(f) {
  f.p.getPacketSender().sendConfig(302, 61); // Priest in Peril complete: the mausoleum Drezel
  return f.spawn(9805, [3441, 9894, 0]);
}

/** Drezel from 315 through his menus to the key box (the escort test's route, t4057-4264). */
function askForKey(f) {
  talk(f.p, drezel(f));
  until(f.p, "Veliaf told me about Ivandis.");
  choose(f.p, "Veliaf told me about Ivandis.");
  until(f.p, "Is there somewhere that I might get more information");
  choose(f.p, "Is there somewhere that I might get more information");
  until(f.p, "The lives of those pitiful few");
  choose(f.p, "The lives of those pitiful few");
  until(f.p, "Drezel gives you a key.");
}

test("a full bag does not lose Drezel's key: it lands under the player, and he replaces a key that is not held", (t) => {
  const f = actor(t, STAGE.IVAN_DELIVERED, MAUSOLEUM);
  fill(f.p, 28);
  askForKey(f);
  assert.equal(stageOf(f.p), STAGE.LIBRARY_KEY);
  assert.equal(amount(f.p, I.TEMPLE_LIBRARY_KEY), 0, "no room in the bag");
  const floor = core.World.getItems().filter((item) => item.getItem().getId() === I.TEMPLE_LIBRARY_KEY
    && item.getPosition().getX() === MAUSOLEUM[0] && item.getPosition().getY() === MAUSOLEUM[1] && item.getOwner?.() === f.p.getUsername());
  assert.equal(floor.length, 1, "the key is on the floor, not lost");
  f.p.getDialogueManager().reset();
  // Not held, so Drezel's lost-key lines hand another (the escort test covers the same at 350).
  f.p.getInventory().deleteNumber(I.BRONZE_DAGGER, 1);
  talk(f.p, drezel(f));
  assert.equal(text(f.p), "I've lost my library key.");
  until(f.p, "Thanks for that!");
  assert.equal(amount(f.p, I.TEMPLE_LIBRARY_KEY), 1);
});

test("a lost Temple library key is reclaimed from Drezel before the library opens; the stage stays", (t) => {
  const f = actor(t, STAGE.LIBRARY_KEY, MAUSOLEUM);
  transcripts = [];
  talk(f.p, drezel(f));
  assert.ok(played("Drezel", "standard-dialogue-after-priest-in-peril"), "the Drezel page's lost-key lines");
  assert.equal(text(f.p), "I've lost my library key.");
  until(f.p, "Thanks for that!");
  assert.equal(amount(f.p, I.TEMPLE_LIBRARY_KEY), 1, "the key is replaced");
  assert.equal(stageOf(f.p), STAGE.LIBRARY_KEY, "no skip forward");
  f.p.getDialogueManager().reset();
  transcripts = [];
  talk(f.p, drezel(f));
  assert.ok(played(PAGE, "asking-drezel-about-ivandis-talking-to-drezel-afterwards"), "with the key held, his afterwards talk");
  assert.equal(amount(f.p, I.TEMPLE_LIBRARY_KEY), 1, "no second key");
});

test("completed players are offered post-quest Drezel lost-key recovery", (t) => {
  // Only Priest in Peril marked complete, so Drezel plays the Drezel page's base post-quest variant
  // (with Nature Spirit complete too, Nature Spirit picks its own post-quest variant, which has no
  // lost-key branch). The wolfbane is held, else Priest in Peril's lost-dagger branch comes first.
  const f = actor(t, STAGE.COMPLETE, MAUSOLEUM, { prerequisites: false });
  meetRequirements(f.p, ["priest_in_peril"]);
  give(f.p, I.WOLFBANE);
  assert.equal(talk(f.p, drezel(f)), true);
  // The Drezel page's "If the player has lost their temple library key" branch (P91CrU / 7Z6IoI).
  for (let i = 0; i < 30 && amount(f.p, I.TEMPLE_LIBRARY_KEY) === 0 && (current(f.p) || menu(f.p)); i++) {
    const lost = menu(f.p)?.options.find((option) => /library key/i.test(option));
    if (menu(f.p) && !lost) break;
    if (lost) choose(f.p, lost);
    else cont(f.p);
  }
  assert.equal(amount(f.p, I.TEMPLE_LIBRARY_KEY), 1, "Drezel replaces a lost library key after completion");
});

test("Drezel hands no library key before In Aid reaches it", (t) => {
  // As above: the base post-Priest-in-Peril page, whose lost-key branch must stay shut at stage 0.
  const f = actor(t, 0, MAUSOLEUM, { prerequisites: false });
  meetRequirements(f.p, ["priest_in_peril"]);
  give(f.p, I.WOLFBANE);
  const lines = [];
  talk(f.p, drezel(f));
  for (let i = 0; i < 30 && current(f.p) && !menu(f.p); i++) { lines.push(text(f.p)); cont(f.p); }
  assert.ok(lines.length > 0, "Drezel's page plays");
  assert.ok(!lines.includes("I've lost my library key."), "the Drezel page's lost-key branch stays shut before the quest");
  assert.equal(amount(f.p, I.TEMPLE_LIBRARY_KEY), 0, "no pre-quest key handout");
});

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

test("the history bookcase is not the quest bookcase", (t) => {
  const { p } = actor(t, STAGE.LIBRARY_OPEN, [3354, 9900, 0]);
  click(p, core.ObjectIdentifiers.BOOKCASE_51, "Search", [3354, 9901, 0]);
  tick(3);
  assert.equal(amount(p, I.THE_SLEEPING_SEVEN), 0, "the history bookcase gives no quest book");
  assert.equal(stageOf(p), STAGE.LIBRARY_OPEN);
  p.getDialogueManager().reset();
  click(p, core.ObjectIdentifiers.BOOKCASE_52, "Search", [3354, 9899, 0]);
  assert.equal(amount(p, I.THE_SLEEPING_SEVEN), 1, "Ivandis' bookcase does");
  assert.equal(stageOf(p), STAGE.BOOK_FOUND);
});

// ---------------------------------------------------------------------------
// The rod: Lvl-1 Enchant
// ---------------------------------------------------------------------------

function rodCaster(t) {
  const f = actor(t, STAGE.ROD_MADE, [2974, 3372, 0]);
  f.p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 70).setCurrentLevel(core.Skill.MAGIC, 70);
  give(f.p, I.SILVTHRILL_ROD_2);
  give(f.p, I.COSMIC_RUNE);
  return f;
}

test("the rod enchantment requires the standard spellbook", (t) => {
  const { p } = rodCaster(t);
  give(p, I.WATER_RUNE);
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  assert.equal(castEnchant(p, I.SILVTHRILL_ROD_2), true, "the attempt is owned");
  tick(12);
  assert.equal(amount(p, I.SILVTHRILL_ROD_3), 0, "no enchant on the Lunar spellbook");
  assert.equal(amount(p, I.COSMIC_RUNE), 1, "runes are not consumed");
  assert.equal(stageOf(p), STAGE.ROD_MADE);
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  castEnchant(p, I.SILVTHRILL_ROD_2);
  assert.equal(stageOf(p), STAGE.ROD_ENCHANTED);
  tick(9);
  assert.equal(amount(p, I.SILVTHRILL_ROD_3), 1, "the standard spellbook enchants it");
});

test("the rod enchantment accepts a wielded water staff for the water rune", (t) => {
  const { p } = rodCaster(t);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.WATER_BATTLESTAFF, 1));
  p.getEquipment().refreshItems?.();
  castEnchant(p, I.SILVTHRILL_ROD_2);
  tick(9);
  assert.equal(amount(p, I.SILVTHRILL_ROD_3), 1, "the staff supplies the water rune");
  assert.equal(amount(p, I.COSMIC_RUNE), 0, "the cosmic rune is spent");
  assert.equal(amount(p, I.WATER_RUNE), 0, "no water rune was needed");
});

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

const ROUTE = [20, 30, 40, 60, 70, 80, 90, 100, 110, 140, 150, 160, 165, 170, 180, 190, 200, 205, 210, 220, 230, 240, 250, 260,
  280, 290, 300, 310, 315, 320, 330, 340, 350, 360, 370, 375, 380, 390, 400, 410, 420, 430];

test("fresh stage 0 reaches completion through the units' handlers, every live stage in order", (t) => {
  const f = actor(t, 0, HIDEOUT);
  const { p } = f;
  // Every value the stage attribute takes (the units' advances and the runtime's completion alike).
  const stages = [];
  const setAttribute = p.setAttribute.bind(p);
  p.setAttribute = (key, value, ...rest) => {
    if (key === STAGE_KEY && Number(value) !== stageOf(p)) stages.push(Number(value));
    return setAttribute(key, value, ...rest);
  };
  const reached = (stage) => assert.equal(stageOf(p), stage, `stage ${stage} (route so far ${stages.join(",")})`);
  const at = (...location) => { p.getDialogueManager().reset?.(); p.moveTo(new core.Location(...location)); tick(); };

  // --- Veliaf's start (0 -> 20), the hideout under Canifis.
  talk(p, f.spawn(9620, [3506, 9838, 0]));
  until(p, "Yes.");
  choose(p, "Yes.");
  until(p, "Exactly. Head down to Burgh de Rott");
  reached(20);
  finish(p);

  // --- Burgh de Rott: Florin's food pelting (varbit 1969 to 3), his talk (30), the chest (40), the inn (60).
  at(3488, 3253, 0);
  const florin = f.spawn(N.FLORIN, [3483, 3243, 0]);
  PM.emitPlayerMapSquareChange({ player: p, previous: null, location: p.getLocation() });
  tick(21);
  assert.equal(varbit(p, VARBIT.FOOD_PELT), 3, "Florin's three throws");
  at(3484, 3242, 0);
  talk(p, florin);
  until(p, "Hey! Don't try to sweet talk me.");
  reached(30);
  finish(p);
  at(3484, 3245, 0);
  give(p, I.SALMON);
  assert.equal(useOn(p, I.SALMON, 12736, [3483, 3246, 0]), true);
  reached(40);
  finish(p);
  tick(12);
  at(3484, 3242, 0);
  talk(p, florin);
  until(p, "Are there any 'out of the way' places here?");
  choose(p, "Are there any 'out of the way' places here?");
  until(p, "Well, there's the inn.");
  reached(60);
  finish(p);

  // --- The inn: the broken wall (70), the collapsed wall (80), the trapdoor (90), the cellar (100).
  at(3491, 3230, 0);
  click(p, 12737, "Climb-over", [3491, 3230, 0]);
  reached(70);
  tick(2);
  give(p, I.RUNE_PICKAXE);
  assert.equal(useOn(p, I.RUNE_PICKAXE, 12738, [3489, 3231, 0]), true);
  tick(4);
  reached(80);
  at(3491, 3232, 0);
  click(p, 12743, "Open", [3490, 3232, 0]);
  reached(90);
  click(p, 12743, "Climb-down", [3490, 3232, 0]);
  reached(100);
  tick();
  assert.equal(p.getLocation().getZ(), 1, "in the cellar copy");

  // --- The cellar: all 15 rubble mined and scooped (110). Five buckets carry three loads each.
  give(p, I.SPADE);
  for (let i = 0; i < 5; i++) give(p, I.BUCKET);
  const rubble = () => (p.getPrivateArea?.()?.getObjects?.() ?? []).filter((object) => [12812, 12813, 12814, 12815].includes(object.getId()));
  for (let n = 0; n < 15; n++) {
    const object = rubble()[0];
    assert.ok(object, `rubble ${n + 1} of 15`);
    const loc = object.getLocation();
    const spot = [loc.getX(), loc.getY(), loc.getZ()];
    p.getDialogueManager().reset?.();
    click(p, object.getId(), "Mine", spot, object);
    tick(9);
    const mined = rubble().find((other) => other.getLocation().equals(loc));
    p.getDialogueManager().reset?.();
    click(p, mined.getId(), "Remove", spot, mined);
    tick(4);
    assert.equal(varbit(p, VARBIT.INN_RUBBLE), n + 1, `scoop ${n + 1}`);
  }
  reached(110);
  finish(p);
  click(p, 12779, "Climb-up", [3490, 9632, 1]);
  tick();
  assert.equal(p.getLocation().getZ(), 0, "back up in the inn");

  // --- Aurel's store (140-170): the agreement, the roof and wall, the crate and its stock.
  const kit = (planks = 3, nails = 12) => { give(p, I.HAMMER); give(p, I.PLANK, planks); give(p, I.STEEL_NAILS, nails); };
  const repair = (id, title, option = "Inspect") => {
    at(...BURGH_STORE);
    click(p, id, option, BURGH_STORE);
    until(p, title);
    choose(p, "Yes.");
    tick(2);
    p.getDialogueManager().reset?.();
  };
  at(...BURGH_STORE);
  const aurel = f.spawn(N.AUREL, [3516, 3238, 0]);
  talk(p, aurel);
  until(p, "I'd like to help fix up the town.");
  choose(p, "I'd like to help fix up the town.");
  until(p, "Please can you fix the roof, then the walls");
  reached(140);
  finish(p);
  kit();
  repair(12751, "Fix the roof?");
  reached(150);
  kit();
  repair(12752, "Fix the wall?");
  reached(160);
  at(...BURGH_STORE);
  talk(p, aurel);
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  until(p, "I need 3 tinderboxes");
  cont(p);
  reached(165);
  assert.equal(amount(p, I.CRATE), 1, "Aurel's crate");
  p.getDialogueManager().reset?.();
  const snails = Number(p.getAttribute("in-aid-of-the-myreque:crate-food")) === 1;
  for (const [itemId, count] of [[I.TINDERBOX, 3], [I.BRONZE_AXE, 10], [snails ? I.THIN_SNAIL : I.RAW_MACKEREL, 10]]) {
    give(p, itemId, count);
    useOnItem(p, itemId, I.CRATE);
    choose(p, "Yes, I'll fill the crate.");
    p.getDialogueManager().reset?.();
  }
  assert.deepEqual([VARBIT.CRATE_TINDERBOXES, VARBIT.CRATE_AXES, VARBIT.CRATE_FOOD].map((id) => varbit(p, id)), [3, 10, 10], "a full crate");
  talk(p, aurel);
  until(p, "Aurel quickly puts the stock out around the shop.");
  reached(170);
  assert.equal(amount(p, I.CRATE), 0, "the crate is handed in");
  p.getDialogueManager().reset?.();

  // --- The bank (180-200) and the furnace (205-210).
  kit(2, 8);
  give(p, I.SWAMP_PASTE);
  repair(12759, "Fix the booth?");
  reached(180);
  kit();
  repair(12760, "Fix the wall?");
  reached(190);
  talk(p, f.spawn(6214, [3516, 3238, 0]));
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  until(p, "Cornelius gets changed");
  tick(2);
  reached(200);
  p.getDialogueManager().reset?.();
  talk(p, f.spawn(N.RAZVAN, [3514, 3238, 0]));
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  finish(p);
  reached(205);
  give(p, I.HAMMER);
  give(p, I.STEEL_BAR, 2);
  repair(12805, "Fix the chimney?");
  reached(210);
  give(p, I.COAL);
  repair(12805, "Refuel the furnace?");
  assert.equal(varbit(p, VARBIT.FURNACE), 2, "fuelled");

  // --- The blood tithe (220-280): the furnace lit, the Castle Drakan scene, the three chats, the fight.
  at(3526, 3209, 0);
  give(p, I.TINDERBOX);
  assert.equal(useOn(p, I.TINDERBOX, 12805, [3527, 3209, 0]), true);
  tick(5);
  reached(220);
  tick(9);
  until(p, "It seems you have a fresh appointment");
  reached(230);
  finish(p);
  tick(6);
  finish(p);
  at(3514, 3240, 0);
  const tithe = (id, x, y) => { const npc = PM.spawnNpc({ id, x, y, z: 0, wanderRadius: 0 }, "Q061Route"); t.after(() => PM.removeNpc(npc)); return npc; };
  talk(p, tithe(6218, 3515, 3241));
  until(p, "Ha! We'll see about that!");
  cont(p);
  p.getDialogueManager().reset?.();
  talk(p, tithe(6217, 3513, 3242));
  until(p, "We're getting some delicious");
  cont(p);
  p.getDialogueManager().reset?.();
  talk(p, tithe(4479, 3515, 3242));
  until(p, "They're draining");
  cont(p);
  tick(5);
  reached(240);
  const fight = (id) => ownedNpcs(p).find((npc) => npc.getContentId(p) === id);
  fight(4484).setHitpoints(0); // Gadderanks is wounded
  tick(5);
  reached(250);
  fight(4486).setHitpoints(0);
  fight(4487).setHitpoints(0);
  tick(1);
  reached(260);
  p.getDialogueManager().reset?.();
  talk(p, fight(4485));
  until(p, "It's too late for me");
  cont(p);
  tick(4);
  reached(280);
  tick(1);
  until(p, "Hey there! Gadderanks dropped this warhammer");
  assert.equal(amount(p, I.GADDERHAMMER), 1, "the Gadderhammer");
  finish(p);
  p.getDialogueManager().reset?.();
  at(3516, 3242, 0);
  talk(p, tithe(4479, 3517, 3242));
  until(p, "Sure.");
  cont(p);
  tick(3);
  assert.equal(varbit(p, VARBIT.BLOOD_TITHE), 3, "Veliaf heads back to the Hollows");
  finish(p);

  // --- The Hollows (290-310): Veliaf, Radigad, Ivan's food and the route map.
  at(...HIDEOUT);
  talk(p, f.spawn(9620, [3506, 9838, 0]));
  until(p, "I'll see what I can dig up.");
  cont(p);
  reached(290);
  until(p, "What do I need to do now?");
  p.getDialogueManager().reset?.();
  talk(p, f.spawn(9626, [3508, 9832, 0]));
  reached(300);
  finish(p);
  p.getDialogueManager().reset?.();
  const ivan = f.spawn(9630, [3512, 9842, 0]);
  talk(p, ivan);
  until(p, "That's right. We should get going soon.");
  cont(p);
  reached(310);
  finish(p);
  p.getPacketSender().sendInterfaceRemoval();
  p.getDialogueManager().reset?.();
  for (let i = 0; i < 8; i++) give(p, I.SALMON);
  useOnNpc(p, ivan, I.SALMON);
  tick();
  until(p, "Yes, I'll offer all");
  choose(p, "Yes, I'll offer all");
  until(p, "You hand over some food to Ivan.");
  cont(p);
  assert.equal(varbit(p, VARBIT.IVAN_FOOD), 8, "Ivan carries the food");
  p.getDialogueManager().reset?.();
  talk(p, ivan);
  until(p, "Very well. I'm ready, lead the way.");
  cont(p);
  tick();
  assert.equal(p.getInterfaceId(), 53, "the route map");

  // --- The swamp (315): route 2, the ambush copy, three juvinates down, the second leg to Paterdomus.
  const mapClick = (child) => PM.emitInterfaceActionClick({ player: p, buttonId: (53 << 16) | child, action: 1, handled: false });
  assert.equal(mapClick(28), true, "route 2");
  assert.equal(mapClick(37), true, "travel");
  tick(8);
  const juvinates = ownedNpcs(p, 4443);
  assert.equal(juvinates.length, 4, "the ambush");
  for (const juvinate of juvinates.slice(0, 3)) { juvinate.setHitpoints(0); juvinate.appendDeath(); }
  for (let i = 0; i < 14 && p.getLocation().getX() !== 3432; i++) tick();
  assert.deepEqual(tile(p).slice(0, 2), [3432, 3484], "outside Paterdomus");
  until(p, "Not a problem. I need to chat to Drezel");
  cont(p);
  reached(315);
  tick(4);
  p.getDialogueManager().reset?.();

  // --- Drezel (320-350), the keyhole and the library (360).
  at(...MAUSOLEUM);
  p.getPacketSender().sendConfig(302, 61);
  talk(p, f.spawn(9805, [3441, 9894, 0]));
  until(p, "Yes, it seems to be");
  cont(p);
  reached(320);
  until(p, "Veliaf told me about Ivandis.");
  choose(p, "Veliaf told me about Ivandis.");
  until(p, "But you don't even know what he said about Ivandis.");
  cont(p);
  reached(330);
  until(p, "Is there somewhere that I might get more information");
  choose(p, "Is there somewhere that I might get more information");
  until(p, "So you have no further information on him");
  cont(p);
  reached(340);
  until(p, "The lives of those pitiful few");
  choose(p, "The lives of those pitiful few");
  until(p, "Drezel gives you a key.");
  reached(350);
  assert.equal(amount(p, I.TEMPLE_LIBRARY_KEY), 1);
  at(3442, 9898, 0);
  assert.equal(useOn(p, I.TEMPLE_LIBRARY_KEY, 12765, [3443, 9898, 0]), true);
  tick();
  p.getDialogueManager().reset?.();
  click(p, 12763, "Climb-down", [3441, 9899, 0]);
  tick();
  reached(360);
  assert.deepEqual(tile(p), [3360, 9904, 0], "in the library");

  // --- The rod (370-420): the book, the tomb, the mould, the rod, the enchant, the Salve.
  at(3354, 9900, 0);
  click(p, core.ObjectIdentifiers.BOOKCASE_52, "Search", [3354, 9899, 0]);
  reached(370);
  p.getDialogueManager().reset?.();
  itemOption(p, I.THE_SLEEPING_SEVEN, "Read");
  reached(375);
  p.getPacketSender().sendInterfaceRemoval();
  at(3483, 9832, 0);
  useOn(p, I.HAMMER, 12772, [3483, 9832, 0]);
  tick(3);
  assert.equal(varbit(p, VARBIT.TOMB_BOARDS), 1, "the boards broken up");
  p.getDialogueManager().reset?.();
  click(p, 12770, "Enter", [3484, 9832, 0]);
  reached(380);
  tick(2);
  at(3510, 9863, 0);
  give(p, I.SOFT_CLAY);
  assert.equal(useOn(p, I.SOFT_CLAY, 12802, [3511, 9863, 0]), true);
  reached(390);
  p.getDialogueManager().reset?.();
  // Checkpoint: the silvthrill rod is Crafting's furnace make-interface (Jewellery.Crafting.js); its
  // "crafting:made" event is what the Rod unit listens for, so the walk sends that instead of the menu.
  give(p, I.SILVTHRILL_ROD_2);
  PM.emitCustomEvent("crafting:made", { player: p, itemId: I.SILVTHRILL_ROD_2, furnace: true, bar: "Silver bar" });
  reached(400);
  give(p, I.COSMIC_RUNE);
  give(p, I.WATER_RUNE);
  assert.equal(castEnchant(p, I.SILVTHRILL_ROD_2), true);
  reached(410);
  tick(9);
  assert.equal(amount(p, I.SILVTHRILL_ROD_3), 1, "the enchanted rod");
  p.getDialogueManager().reset?.();
  at(3423, 9891, 0);
  give(p, I.ROPE);
  assert.equal(useOn(p, I.SILVTHRILL_ROD_3, 3485, [3423, 9890, 0]), true);
  tick(4);
  reached(420);
  assert.equal(amount(p, I.ROD_OF_IVANDIS_10_), 1, "the Rod of Ivandis");
  p.getDialogueManager().reset?.();

  // --- The hand-in (430) and the rewards.
  at(3494, 9630, 0);
  const points = Number(p.getAttribute("quest.points")) || 0;
  const xp = p.getSkillManager().getExperience(core.Skill.ATTACK);
  talk(p, new core.NPC(8277, new core.Location(3494, 9628, 0)));
  until(p, "You give the Rod of Ivandis to Veliaf.");
  assert.equal(amount(p, I.ROD_OF_IVANDIS_10_), 0, "the rod is handed to Veliaf");
  assert.ok(f.seen.varbits.some(([id, value]) => id === VARBIT.QUEST && value === 430), "varbit 1990 = 430 with the box");
  until(p, "Well ");
  cont(p);
  reached(430); // the rewards on the continue after "Well [player name]..."
  assert.equal(complete(p), true, "the quest is complete");
  assert.equal(Number(p.getAttribute("quest.points")), points + 2, "two quest points");
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK) - xp, 2000, "2,000 Attack XP (and Strength, Defence, Crafting)");

  assert.deepEqual(stages, ROUTE, "every live stage, once, in order");
});
