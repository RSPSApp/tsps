const assert = require("node:assert/strict"), path = require("node:path");
const { before, after, test } = require("node:test");
const { Server } = require("../dist/Server"); Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { combinationLockAmount } = require("../plugins/quests/QuestPuzzleLocks");

const KEY = "easter-2026";
let core, c, Progress, Scene, Lock, Rewards, archive;
const lifetime = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi(); c = core.CacheDefinitions; core.RegionManager.init();
  for (const [name, file] of [["DefinitionArchives", "world/DefinitionArchives"], ["NpcDialogues", "npcs/NpcDialogues"],
    ["HolidayRewards", "world/HolidayRewards"], ["EasterEvents", "world/EasterEvents"]]) {
    require(`../plugins/${file}.plugin.js`).register(PM.createApi(name));
  }
  // Play time is owned by PlayerOnlineTimer; the fixture answers it directly.
  PM.createApi("EasterTest").onCustomEvent("player:lifetime-seconds", request => { request.seconds = lifetime.get(request.player) ?? 0; });
  Progress = require("../plugins/world/seasonal/Progress.EasterEvents");
  Scene = require("../plugins/world/seasonal/Scene.EasterEvents");
  Lock = require("../plugins/world/seasonal/Lock.EasterEvents");
  Rewards = require("../plugins/world/seasonal/Rewards.EasterEvents");
  archive = require("../plugins/world/seasonal/data/easter-2026-archive.json");
});
after(() => window(false));

// Through the real scheduler: the Easter grant goes through events:grant-reward, which trusts only its window.
const { setWindow } = require("./helpers/event-window.cjs");
function window(active) { setWindow(PM, KEY, active); }
function fixture(name = "easterqa") {
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setUsername(name);
  p.isRegistered = () => true;
  const messages = []; p.sendMessage = m => messages.push(m);
  p.setLocation(new core.Location(3160, 3456, 0));
  return { p, messages };
}
function npcOf(symbol) {
  const id = Scene.npcId({ core }, symbol);
  return [...core.World.getNpcs()].find(npc => npc && npc.getId() === id);
}
function drain(p, choose = 1) {
  const manager = p.getDialogueManager(), seen = [];
  for (let limit = 200; limit > 0; limit--) {
    if (MultiChatboxPrompt.getPending(p)) {
      seen.push("menu:" + MultiChatboxPrompt.getPending(p).title);
      MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: choose });
      continue;
    }
    if (!manager.isActive()) break;
    seen.push(manager.getCurrent()?.constructor?.name);
    manager.advance();
  }
  return seen;
}
function talk(p, choose = 1) {
  const npc = npcOf("easter26_easter_bunny");
  PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: 1, location: { x: 3159, y: 3458, z: 0 }, handled: false });
  return drain(p, choose);
}
function standing(l) { return [...(core.MapObjects.mapObjects.get(core.MapObjects.getHash(l.getX(), l.getY(), l.getZ())) ?? [])]; }
function sceneryAt(symbol) {
  const row = archive.placements.find(r => r.symbol === symbol);
  return standing(new core.Location(row.x, row.y, row.z)).find(o => o.getId() === row.id);
}
function search(p, symbol) {
  const object = sceneryAt(symbol), l = object.getLocation();
  const event = { player: p, object, objectId: object.getId(), clickType: 1, location: { x: l.getX(), y: l.getY(), z: l.getZ() }, handled: false };
  PM.emitObjectInteraction(event); drain(p);
  return event.handled;
}
function itemOp(p, symbol) {
  const id = c.getObjId(symbol), slot = p.getInventory().getSlotForItemId(id);
  PM.emitItemAction({ player: p, interfaceId: 149, item: p.getInventory().get(slot), itemId: id, slot, clickType: 1, handled: false });
  drain(p);
}
function count(p, symbol) { return p.getInventory().getAmount(c.getObjId(symbol)); }
function state(p) { return Progress.read(p); }
function catchVault(p) {
  const npc = npcOf("easter26_egg_last_spot");
  PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: 1, location: { x: 3191, y: 9827, z: 0 }, handled: false });
  drain(p);
}
function hunt(p) {
  talk(p, 1); search(p, "easter26_first_clue"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_chemisty_shelves1_easter26"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_stepladders_easter26");
  itemOp(p, "easter26_second_location_egg_box"); p.getEnteredAmountAction().execute(combinationLockAmount(Lock.digits({ core }))); drain(p);
  itemOp(p, "easter26_clue_stack"); search(p, "fai_varrock_castle_battlement_easter26"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_sword_table_easter26"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_posh_chair2_easter26"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_single_bed_easter26"); itemOp(p, "easter26_sixth_location_egg_box"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_suitofarmour_easter26"); itemOp(p, "easter26_clue_stack");
  catchVault(p);
}

test("the event-active cache supplies the four retired NPCs, eight hunt swaps and the LOWE lock", () => {
  assert.deepEqual(archive.bundle.definitions.map(row => row.symbol).sort(),
    ["easter26_easter_bunny", "easter26_egg_church_cutscene", "easter26_egg_last_spot", "easter26_egg_last_spot_found"]);
  const hunt = archive.placements.filter(row => /easter26/.test(row.symbol));
  assert.equal(hunt.length, 8);
  assert.equal(hunt.find(row => row.symbol === "fai_varrock_chemisty_shelves1_easter26").replaces[0].symbol, "fai_varrock_chemisty_shelves1");
  assert.deepEqual(Lock.digits({ core }).length, 4);
});

test("outside the window nothing is placed; the window installs and then restores the exact world", () => {
  const shelves = new core.Location(3198, 3406, 0), originalId = c.getLocId("fai_varrock_chemisty_shelves1");
  core.RegionManager.loadMapFiles(3198, 3406, false);
  const native = () => standing(shelves).filter(o => o.getType() === 10).map(o => o.getId());
  assert.deepEqual(native(), [originalId]);
  assert.equal(npcOf("easter26_easter_bunny"), undefined);
  window(true);
  assert.deepEqual(native(), [c.getLocId("fai_varrock_chemisty_shelves1_easter26")]);
  const bunny = npcOf("easter26_easter_bunny");
  assert.ok(bunny); assert.equal(bunny.getLocation().getX(), 3159); assert.equal(bunny.getLocation().getY(), 3458);
  window(true); // a repeated activation does not spawn twice
  assert.equal([...core.World.getNpcs()].filter(n => n && n.getId() === npcOf("easter26_easter_bunny").getId()).length, 1);
  window(false);
  assert.deepEqual(native(), [originalId]);
  assert.equal(npcOf("easter26_easter_bunny"), undefined);
  assert.equal(c.getDefinitionArchiveBundles().some(b => b.id === KEY), false);
});

test("a full hunt grants Archibald, the play-time eggs and every Diango Easter unlock once", () => {
  window(true);
  const { p } = fixture("easterfull"); lifetime.set(p, Rewards.RARE_PLAY_SECONDS);
  hunt(p);
  assert.equal(state(p).caught, true); assert.equal(count(p, "easter26_runaway_egg"), 1);
  talk(p); core.TaskManager.process();
  assert.equal(state(p).complete, true);
  assert.equal(count(p, "easter26_egg_companion"), 1);
  assert.equal(count(p, "cert_easter_egg"), 2);
  assert.equal(count(p, "easter26_runaway_egg"), 0);
  assert.equal(p.getInterfaceId(), c.getInterfaceId("eventscroll"));
  assert.deepEqual([...p.getAttribute("holiday-rewards:unlocked")].sort(), [...Rewards.UNLOCKS].sort());
  p.getPacketSender().sendInterfaceRemoval(); talk(p);
  assert.equal(count(p, "easter26_egg_companion"), 1, "post-event talk cannot regrant");
  assert.deepEqual(p.getAttribute("events:completions"), [KEY], "the grant records its once-per-account completion");
  window(false);
});

test("a hunt finished before EventScheduler kept completions is imported on login and never granted again", () => {
  window(true);
  const { p } = fixture("easterlegacy");
  Progress.write(PM.createApi("EasterLegacy"), p, { ...state(p), started: true, complete: true });
  Rewards.importClaim(PM.createApi("EasterLegacy"), { player: p });
  assert.deepEqual(p.getAttribute("events:completions"), [KEY]);
  // A caught egg on a rolled-back save still cannot pass the recorded completion; the egg stays.
  Progress.write(PM.createApi("EasterLegacy"), p, { ...state(p), caught: true, complete: false });
  p.getInventory().add(new core.Item(c.getObjId("easter26_runaway_egg"), 1), false);
  assert.equal(Rewards.claim(PM.createApi("EasterLegacy"), p), false);
  assert.equal(count(p, "easter26_egg_companion"), 0);
  assert.equal(count(p, "easter26_runaway_egg"), 1);
  assert.equal(state(p).complete, true, "the recorded completion settles the rolled-back progress");
  window(false);
});

test("short play time withholds the eggs; a full inventory refuses without completing or losing the egg", () => {
  window(true);
  const { p } = fixture("easterfull2");
  hunt(p);
  for (let slot = 0; slot < 28; slot++) if (!(p.getInventory().get(slot)?.getId() > 0)) p.getInventory().setItem(slot, new core.Item(c.getObjId("bronze_sword"), 1));
  const free = p.getInventory().getFreeSlots(); assert.equal(free, 0);
  talk(p);
  assert.equal(state(p).complete, false); assert.equal(count(p, "easter26_runaway_egg"), 1);
  p.getInventory().deleteAtSlot(27, 1);
  talk(p);
  assert.equal(state(p).complete, true); assert.equal(count(p, "cert_easter_egg"), 0); assert.equal(count(p, "easter26_egg_companion"), 1);
  window(false);
});

test("a wrong egg box code refuses with the transcript line; held weapons stop a catch", () => {
  window(true);
  const { p, messages } = fixture("easterlock");
  talk(p, 1); search(p, "easter26_first_clue"); itemOp(p, "easter26_clue_stack");
  const weapon = c.getObjId("bronze_sword");
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  search(p, "fai_varrock_chemisty_shelves1_easter26");
  assert.equal(state(p).note, 1, "both hands must be free");
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, null);
  search(p, "fai_varrock_chemisty_shelves1_easter26"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_stepladders_easter26");
  itemOp(p, "easter26_second_location_egg_box"); p.getEnteredAmountAction().execute(0); drain(p);
  assert.ok(messages.includes("That didn't seem to work."));
  assert.equal(state(p).note, 2); assert.equal(count(p, "easter26_second_location_egg_box"), 1);
  window(false);
});

test("searching ahead of the hunt does nothing, and lost notes come back from the Bunny", () => {
  window(true);
  const { p } = fixture("easterlost");
  talk(p, 1);
  assert.equal(search(p, "fai_varrock_suitofarmour_easter26"), false);
  search(p, "easter26_first_clue");
  assert.equal(count(p, "easter26_clue_stack"), 1);
  p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(c.getObjId("easter26_clue_stack")), 1);
  talk(p);
  assert.equal(count(p, "easter26_clue_stack"), 1);
  window(false);
});

test("progress is one saved integer that keeps the hunt across a relog", () => {
  const { p } = fixture("eastersave");
  Progress.write({ emitCustomEvent() {} }, p, { note: 5, read: true, box: 0, caught: false, started: true, complete: false });
  const saved = p.getAttribute(Progress.PROGRESS_ATTRIBUTE);
  assert.equal(Number.isInteger(saved), true);
  assert.deepEqual(Progress.unpack(saved), { note: 5, read: true, box: 0, caught: false, started: true, complete: false });
  assert.equal(Progress.target(Progress.unpack(saved)), 5);
});

test("a destroyed egg box sends the player back to search for another, not into a dead end", () => {
  window(true);
  const { p } = fixture("easterbox");
  talk(p, 1); search(p, "easter26_first_clue"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_chemisty_shelves1_easter26"); itemOp(p, "easter26_clue_stack");
  search(p, "fai_varrock_stepladders_easter26");
  const box = c.getObjId("easter26_second_location_egg_box"), inventory = p.getInventory();
  const slot = inventory.getSlotForItemId(box), item = inventory.get(slot);
  inventory.deleteAtSlot(slot, 1);
  PM.emitCustomEvent("item:discarded", { player: p, item });
  assert.equal(state(p).box, 0);
  assert.equal(search(p, "fai_varrock_stepladders_easter26"), true);
  assert.equal(count(p, "easter26_second_location_egg_box"), 1);
  assert.equal(state(p).note, 2);
  window(false);
});

test("returning after a refused claim plays the shorter line and completes; a lost runaway egg can be caught again", () => {
  window(true);
  const { p } = fixture("easterreturn");
  hunt(p);
  const runaway = c.getObjId("easter26_runaway_egg");
  p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(runaway), 1); // lost without any discard event
  catchVault(p);
  assert.equal(count(p, "easter26_runaway_egg"), 1, "the vault Archibald can be caught again");
  for (let slot = 0; slot < 28; slot++) if (!(p.getInventory().get(slot)?.getId() > 0)) p.getInventory().setItem(slot, new core.Item(c.getObjId("bronze_sword"), 1));
  const first = talk(p);
  assert.equal(state(p).complete, false);
  p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(c.getObjId("bronze_sword")), 1);
  const second = talk(p); core.TaskManager.process();
  assert.ok(second.length < first.length, "the return conversation skips the finding speech");
  assert.equal(state(p).complete, true);
  assert.equal(count(p, "easter26_egg_companion"), 1);
  window(false);
});
