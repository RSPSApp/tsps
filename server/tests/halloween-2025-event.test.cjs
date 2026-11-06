// 2025 Halloween event (Spook-a-thon): scene lifecycle and the full progression
// through real Players, real inventories and the native dialogue packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const Progress = require("../plugins/world/seasonal/Progress.HalloweenEvents");
const Scene = require("../plugins/world/seasonal/Scene.HalloweenEvents");
const archive = require("../plugins/world/seasonal/data/halloween-2025-archive.json");
const sceneData = require("../plugins/world/seasonal/data/halloween-2025-scene.json");

const { STAGE } = Progress;
let core, index = 7600, lifetime = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  // Play time is owned by PlayerOnlineTimer; answer it deterministically here.
  PM.createApi("HalloweenTest").onCustomEvent("player:lifetime-seconds", request => { request.seconds = lifetime; });
});
after(() => PM.emitServerShutdown({}));

// Through the real scheduler: the rewards go through events:grant-reward, which trusts only its window.
const { setWindow } = require("./helpers/event-window.cjs");
function setActive(active) { setWindow(PM, "halloween-2025", active); }

function fixture(t, at = new core.Location(3189, 3274, 0)) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++);
  player.setUsername("hw25qa" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(at);
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", message => { messages.push(String(message)); return player.getPacketSender(); });
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection, messages };
}

/** The player-update tick is not run here: place a moved player and list the NPCs it would send. */
function seeNearbyNpcs(player) {
  player.needsPlacement = false;
  const local = player.getLocalNpcs();
  for (const npc of core.World.getNpcs()) {
    if (!npc?.isRegistered() || local.includes(npc) || !npc.isVisible?.()) continue;
    if (npc.getLocation().getZ() !== player.getLocation().getZ() || npc.getLocation().getDistance(player.getLocation()) > 15) continue;
    if (npc.isOwnerOnly?.() && npc.getOwner?.() !== player) continue;
    local.push(npc);
  }
}

async function resume(f, choice) {
  const pending = MultiChatboxPrompt.getPending(f.player);
  const group = [231, 217, 193, 229, 11].find(group => f.player.getPacketSender().isChatboxInterface(group));
  const packet = pending ? { widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice ?? 1 } : { widgetId: (group << 16) | 5, childIndex: -1 };
  await f.connection.dispatch([{ type: "dialogue_continue", ...packet }]);
  f.connection.processTurnPackets();
}

/** Runs the conversation to its end, answering each option menu from `choices` (1-based). */
async function converse(f, choices = []) {
  const queue = [...choices], seen = [];
  for (let step = 0; step < 200; step++) {
    for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
    seeNearbyNpcs(f.player);
    const pending = MultiChatboxPrompt.getPending(f.player);
    if (!f.player.getDialogueManager().getCurrent() && !pending) return;
    if (pending) seen.push(pending.options.join(" | "));
    await resume(f, pending ? (queue.shift() ?? 1) : undefined);
  }
  assert.fail("dialogue did not finish; menus: " + seen.slice(0, 12).join(" // "));
}

function npc(symbol, x, y) {
  const id = core.CacheDefinitions.getNpcId(symbol) ?? core.CacheDefinitions.getArchivedId("halloween-2025", "npc", symbol);
  return core.NPC.create(id, new core.Location(x, y, 0));
}

async function talk(f, actor, choices) {
  // The player walks up to whoever they talk to.
  const at = actor.getLocation();
  f.player.setLocation(new core.Location(at.getX(), at.getY() + 1, at.getZ()));
  seeNearbyNpcs(f.player);
  const handled = PM.emitNpcInteraction({ player: f.player, npc: actor, clickType: 1, option: 1 });
  assert.ok(handled, "Talk-to was handled");
  await converse(f, choices);
}

/** Map originals and runtime objects standing on a tile. */
function tileObjects(x, y) {
  const location = new core.Location(x, y, 0);
  return [...(core.MapObjects.mapObjects.get(core.MapObjects.getHash(x, y, 0)) ?? []), ...core.ObjectManager.objectsAt(location)]
    .filter(object => object.getLocation().getX() === x && object.getLocation().getY() === y && !object.getPrivateArea());
}

function tick(count = 1) { for (let index = 0; index < count; index++) core.TaskManager.process(); }
function interfaceOpen(f, name) { return f.player.getInterfaceId() === core.CacheDefinitions.getInterfaceId(name); }

function item(symbol) { return Progress.itemId({ core }, symbol); }
function stage(f) { return Progress.read(f.player).stage; }

test("the window installs the event scene and closing restores the original map", () => {
  setActive(true);
  try {
    assert.equal(Scene.active(), true);
    const scarecrow = core.CacheDefinitions.getLocId("hw25_scarecrow");
    assert.ok(tileObjects(3190, 3278).some(object => object.getId() === scarecrow), "decorations placed");
    const displaced = archive.displaced.find(row => row.x === 3190 && row.y === 3276);
    assert.ok(!tileObjects(3190, 3276).some(object => object.getId() === displaced.id), "displaced scenery removed");
    const chairId = core.CacheDefinitions.getArchivedId("halloween-2025", "npc", "hw25_chair_npc_event");
    assert.equal([...core.World.getNpcs()].filter(npc => npc?.getId() === chairId).length, sceneData.eventChairs.length);
    // Reopening is idempotent: nothing doubles up.
    setActive(true);
    assert.equal([...core.World.getNpcs()].filter(npc => npc?.getId() === chairId).length, sceneData.eventChairs.length);
  } finally {
    setActive(false);
  }
  assert.equal(Scene.active(), false);
  const displaced = archive.displaced.find(row => row.x === 3190 && row.y === 3276);
  assert.ok(tileObjects(3190, 3276).some(object => object.getId() === displaced.id), "original scenery restored");
  assert.ok(!tileObjects(3190, 3278).some(object => object.getId() === core.CacheDefinitions.getLocId("hw25_scarecrow")), "event scenery removed");
  assert.ok(!core.CacheDefinitions.getDefinitionArchiveBundles().some(bundle => bundle.id === "halloween-2025"));
  setActive(false);
});

test("the whole Spook-a-thon runs through native dialogue, once per account", async t => {
  setActive(true);
  t.after(() => setActive(false));
  lifetime = 0;
  const f = fixture(t);
  const fred = npc("fred_the_farmer", 3189, 3273), seth = npc("favour_seth_groats", 3228, 3291);
  const sarah = npc("farming_shopkeeper_1", 3038, 3292), death = npc("death_office_death", 3174, 5726);
  // Death's Office spawns Death for each visitor, owned by them.
  death.setOwner(f.player);
  const diango = npc("aprilfoolshorsesalesman", 3081, 3247);

  await talk(f, fred, [1, 1]);
  assert.equal(stage(f), STAGE.STARTED);
  await talk(f, seth, [1]);
  assert.equal(stage(f), STAGE.COLLECTING);
  assert.equal(f.player.getInventory().getAmount(item("hw25_spooky_painting")), 1);

  const chair = npc("hw25_chair_npc_event", 3106, 3355);
  assert.ok(PM.emitNpcInteraction({ player: f.player, npc: chair, clickType: 1, option: 1 }));
  assert.equal(f.player.getInventory().getAmount(item("hw25_chair_obj_reward")), 1);
  assert.ok(PM.emitNpcInteraction({ player: f.player, npc: chair, clickType: 1, option: 1 }));
  assert.equal(f.player.getInventory().getAmount(item("hw25_chair_obj_reward")), 1, "a second chair is refused");

  await talk(f, sarah, [1]);
  assert.equal(Progress.read(f.player).sarahIntro, true);
  f.player.setLocation(new core.Location(3030, 3305, 0));
  PM.emitCustomEvent("player:emote", { player: f.player, slot: 12, sequence: core.CacheDefinitions.getSeqId("emote_dance") });
  assert.equal(Progress.read(f.player).sarahEmote, true);
  assert.ok(f.messages.includes("The cows seemed to enjoy that. You should return to Sarah."));
  await talk(f, sarah, []);
  assert.equal(f.player.getInventory().getAmount(item("hw25_spooky_scarecrow")), 1);

  // Death's quiz, with one wrong answer first: NpcDialogues' "previous" returns to
  // Death's event question, so the player says Yes again and restarts the quiz.
  await talk(f, death, [1, 1, 1, 3, 1, 2, 3, 1]);
  assert.equal(Progress.quizComplete(Progress.read(f.player)), true);
  assert.equal(f.player.getInventory().getAmount(item("hw25_spooky_wall_lamp")), 1);

  await talk(f, fred, [1]);
  assert.equal(stage(f), STAGE.DECORATED);
  for (const symbol of Object.values(Progress.DECORATIONS)) assert.equal(f.player.getInventory().getAmount(item(symbol)), 0, symbol + " handed over");

  // Diango wants three Halloween items worn; the 2024 cosmetics do not count.
  f.player.getEquipment().setItem(0, new core.Item(core.CacheDefinitions.getObjId("hw24_scarecrow"), 1));
  await talk(f, diango, [1]);
  assert.equal(stage(f), STAGE.DECORATED, "no lantern without three Halloween items");
  tick(2);
  assert.ok(interfaceOpen(f, "rareitems_diango"), "Diango's holiday items stay open after his conversation");
  f.player.closeInterruptibleInterfaces();
  f.player.getEquipment().setItem(0, new core.Item(core.CacheDefinitions.getObjId("hw06_spooky_head"), 1));
  f.player.getEquipment().setItem(4, new core.Item(core.CacheDefinitions.getObjId("hw06_spooky_body"), 1));
  f.player.getEquipment().setItem(7, new core.Item(core.CacheDefinitions.getObjId("hw06_spooky_legs"), 1));
  await talk(f, diango, [1]);
  assert.equal(stage(f), STAGE.LANTERN);
  const lantern = item("hw25_pumpkin_lantern_reward");
  assert.equal(f.player.getInventory().getAmount(lantern), 1);

  // Holding the lantern in the inventory is not enough for the judging.
  await talk(f, fred, [1]);
  assert.equal(stage(f), STAGE.LANTERN);
  f.player.getInventory().delete(new core.Item(lantern, 1));
  f.player.getEquipment().setItem(3, new core.Item(lantern, 1));
  await talk(f, fred, [1]);
  assert.equal(stage(f), STAGE.COMPLETE);
  for (const symbol of ["hw25_grim_reaper_top", "hw25_grim_reaper_bottoms", "hw25_grim_reaper_gloves", "hw25_chair_obj_reward"]) {
    assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId(symbol)), 1, symbol);
  }
  assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId("cert_pumpkin")), 0, "no tradeables under 24 hours");
  assert.ok(f.messages.includes("You've completed the Halloween event: Spook-a-thon Decoration Contest"));
  tick(2);
  assert.ok(interfaceOpen(f, "eventscroll"), "the event-complete scroll stays open");
  f.player.closeInterruptibleInterfaces();

  // Later, at 24 hours of play, Fred hands over the tradeables exactly once.
  lifetime = 86400;
  assert.ok(PM.emitNpcInteraction({ player: f.player, npc: fred, clickType: 1, option: 1 }));
  assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId("cert_pumpkin")), 2);
  PM.emitNpcInteraction({ player: f.player, npc: fred, clickType: 1, option: 1 });
  await converse(f);
  assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId("cert_pumpkin")), 2, "never twice");
  assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId("hw25_grim_reaper_top")), 1, "no re-award");
  assert.deepEqual(f.player.getAttribute("events:completions"), ["halloween-2025", "halloween-2025-tradeables"]);
});

test("claims made before EventScheduler kept completions are imported on login", t => {
  const f = fixture(t), Rewards = require("../plugins/world/seasonal/Rewards.HalloweenEvents");
  setProgress(f, { stage: STAGE.COMPLETE, tradeableClaimed: true });
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.deepEqual(f.player.getAttribute("events:completions"), ["halloween-2025", "halloween-2025-tradeables"]);
  const g = fixture(t);
  setProgress(g, { stage: STAGE.COMPLETE });
  Rewards.importClaim(PM.createApi("HalloweenLegacy"), { player: g.player });
  assert.deepEqual(g.player.getAttribute("events:completions"), ["halloween-2025"], "unclaimed tradeables stay claimable");
});

test("a rolled-back save whose completions are recorded settles its progress and Fred talks normally", t => {
  setActive(true);
  t.after(() => setActive(false));
  lifetime = 86400;
  const f = fixture(t), Rewards = require("../plugins/world/seasonal/Rewards.HalloweenEvents");
  for (const completion of ["halloween-2025", "halloween-2025-tradeables"]) {
    PM.emitCustomEvent("events:record-completion", { player: f.player, completion });
  }
  setProgress(f, { stage: STAGE.JUDGED });
  assert.equal(Rewards.claim(PM.createApi("HalloweenRollback"), f.player), false);
  assert.equal(stage(f), STAGE.COMPLETE);
  assert.equal(Progress.read(f.player).tradeableClaimed, true, "the recorded tradeables are settled too");
  setProgress(f, { stage: STAGE.COMPLETE });
  assert.equal(Rewards.claimTradeables(PM.createApi("HalloweenRollback"), f.player), false, "Fred falls through to his normal dialogue");
  assert.equal(Progress.read(f.player).tradeableClaimed, true);
  assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId("cert_pumpkin")), 0, "nothing is handed over twice");
});

test("a full inventory keeps the decoration with Seth and the stage unchanged", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t);
  await talk(f, npc("fred_the_farmer", 3189, 3273), [1, 1]);
  for (let slot = 0; slot < 28; slot++) f.player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  await talk(f, npc("favour_seth_groats", 3228, 3291), [1]);
  assert.equal(stage(f), STAGE.STARTED);
  assert.equal(Progress.read(f.player).picture, false);
});

test("declining the event question hands Talk-to back to the ordinary owner", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t);
  PM.emitNpcInteraction({ player: f.player, npc: npc("fred_the_farmer", 3189, 3273), clickType: 1, option: 1 });
  await resume(f, 2);
  assert.equal(stage(f), STAGE.NEW);
  assert.ok(f.player.getDialogueManager().getCurrent() || MultiChatboxPrompt.getPending(f.player), "Fred's ordinary conversation plays");
  await converse(f);
});

test("outside the window Fred's Talk-to is his ordinary conversation", async t => {
  setActive(false);
  const f = fixture(t);
  PM.emitNpcInteraction({ player: f.player, npc: npc("fred_the_farmer", 3189, 3273), clickType: 1, option: 1 });
  assert.equal(MultiChatboxPrompt.getPending(f.player)?.title === "Ask about Halloween Event?", false);
  await converse(f);
  assert.equal(stage(f), STAGE.NEW);
});

test("Seth replaces a lost picture whether or not the other decorations are done", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const picture = item("hw25_spooky_painting");
  for (const others of [false, true]) {
    const f = fixture(t), seth = npc("favour_seth_groats", 3228, 3291);
    setProgress(f, { stage: STAGE.COLLECTING, picture: true, chair: others, scarecrow: others, lamp: others });
    for (let slot = 0; slot < 28; slot++) f.player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
    await talk(f, seth, [1]);
    assert.equal(f.player.getInventory().getAmount(picture), 0, "full: Seth holds on to it");
    f.player.getInventory().resetItems();
    await talk(f, seth, [1]);
    assert.equal(f.player.getInventory().getAmount(picture), 1, `replaced (other decorations done: ${others})`);
    assert.equal(f.messages.includes("You have acquired a spooky picture, a chair, scarecrow and wall lamp. You should return to Fred in Lumbridge."), others);
  }
});

test("Diango's replacement lantern into the last slot plays no full-inventory line", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t), diango = npc("aprilfoolshorsesalesman", 3081, 3247);
  setProgress(f, { stage: STAGE.LANTERN, picture: true, chair: true, scarecrow: true, lamp: true, diangoIntro: true });
  for (let slot = 0; slot < 27; slot++) f.player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  const lines = [];
  const listener = PM.createApi("HalloweenLineProbe");
  listener.onCustomEvent("npc-dialogue:line", event => lines.push(String(event.text)));
  await talk(f, diango, [1]);
  assert.equal(f.player.getInventory().getAmount(item("hw25_pumpkin_lantern_reward")), 1);
  assert.ok(!lines.some(text => text.startsWith("Ah, but I see you don't have space")), lines.join(" | "));
});

/** Controlled setup: progress written directly to a later stage (the walkthrough test covers reaching it). */
function setProgress(f, changes) {
  f.player.setAttribute(Progress.PROGRESS_ATTRIBUTE, { ...Progress.initial(), ...changes });
}
function dressForContest(f) {
  f.player.getEquipment().setItem(0, new core.Item(core.CacheDefinitions.getObjId("hw06_spooky_head"), 1));
  f.player.getEquipment().setItem(4, new core.Item(core.CacheDefinitions.getObjId("hw06_spooky_body"), 1));
  f.player.getEquipment().setItem(7, new core.Item(core.CacheDefinitions.getObjId("hw06_spooky_legs"), 1));
  f.player.getEquipment().setItem(3, new core.Item(item("hw25_pumpkin_lantern_reward"), 1));
}

test("Death replaces a lost wall lamp but not one stored in the bank", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t), death = npc("death_office_death", 3174, 5726);
  death.setOwner(f.player);
  setProgress(f, { stage: STAGE.COLLECTING, picture: true, lamp: true, quiz: 31, deathIntro: true });
  const lamp = item("hw25_spooky_wall_lamp");
  f.player.getBank(0).add(new core.Item(lamp, 1));
  await talk(f, death, [1]);
  assert.equal(f.player.getInventory().getAmount(lamp), 0, "a banked lamp is not duplicated");
  f.player.getBank(0).resetItems();
  await talk(f, death, [1]);
  assert.equal(f.player.getInventory().getAmount(lamp), 1, "a lost lamp is replaced");
});

test("judging with a full inventory waits for space, then rewards exactly once", async t => {
  setActive(true);
  t.after(() => setActive(false));
  lifetime = 0;
  const f = fixture(t), fred = npc("fred_the_farmer", 3189, 3273);
  setProgress(f, { stage: STAGE.LANTERN, briefed: true, picture: true, chair: true, scarecrow: true, lamp: true, quiz: 31 });
  dressForContest(f);
  for (let slot = 0; slot < 26; slot++) f.player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  await talk(f, fred, [1]);
  assert.equal(stage(f), STAGE.JUDGED);
  assert.ok(f.messages.includes("You need 2 free inventory slots to receive your Halloween event rewards."), f.messages.slice(-3).join(" | "));
  f.player.getInventory().resetItems();
  await talk(f, fred, [1]);
  assert.equal(stage(f), STAGE.COMPLETE);
  assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getObjId("hw25_grim_reaper_top")), 1);
});

test("logging out mid-cutscene removes the owner-only actors", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t), fred = npc("fred_the_farmer", 3189, 3273);
  setProgress(f, { stage: STAGE.LANTERN, briefed: true, picture: true, chair: true, scarecrow: true, lamp: true, quiz: 31 });
  dressForContest(f);
  f.player.setLocation(new core.Location(3189, 3274, 0));
  assert.ok(PM.emitNpcInteraction({ player: f.player, npc: fred, clickType: 1, option: 1 }));
  for (let step = 0; step < 4; step++) await resume(f, 1);
  const death = core.CacheDefinitions.getArchivedId("halloween-2025", "npc", "hw25_deadth_cs");
  assert.ok([...core.World.getNpcs()].some(npc => npc?.getId() === death && npc.getOwner() === f.player), "the cutscene has started");
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.ok(![...core.World.getNpcs()].some(npc => npc?.getId() === death && npc.getOwner() === f.player));
  assert.equal(stage(f), STAGE.LANTERN);
});

/** The chair's first inventory option is its own Drop (cache iop1). */
function dropChair(f, chair) {
  const slot = f.player.getInventory().getSlotForItemId(chair);
  PM.emitItemAction({ player: f.player, interfaceId: 149, item: f.player.getInventory().getItems()[slot], itemId: chair, slot, clickType: 1, handled: false });
}

test("the spooky chair is locked during the event, then follows and comes back", async t => {
  setActive(true);
  const f = fixture(t), chair = item("hw25_chair_obj_reward");
  setProgress(f, { stage: STAGE.COLLECTING, chair: true });
  f.player.getInventory().setItem(0, new core.Item(chair, 1));
  dropChair(f, chair);
  assert.ok(f.messages.includes("You shouldn't play with the chair yet. Fred needs it!"));
  assert.equal(f.player.getInventory().getAmount(chair), 1);
  setActive(false);
  setProgress(f, { stage: STAGE.COMPLETE });
  dropChair(f, chair);
  assert.equal(f.player.getInventory().getAmount(chair), 0, "the chair is out following");
  for (let tick = 0; tick < 21; tick++) core.TaskManager.process();
  assert.equal(f.player.getInventory().getAmount(chair), 1);
  assert.ok(f.messages.includes("The spooky chair makes its way back to you."));
  dropChair(f, chair);
  for (let slot = 0; slot < 28; slot++) f.player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  for (let tick = 0; tick < 21; tick++) core.TaskManager.process();
  assert.ok(f.messages.includes("The spooky chair doesn't feel wanted and returns to Diango in Draynor Village."));
  assert.ok((f.player.getAttribute("holiday-rewards:unlocked") ?? []).includes("hw25_chair_obj_reward"), "retrievable from Diango");
});

test("a chair taken back from Diango while another follows never makes two", async t => {
  setActive(false);
  const f = fixture(t), chair = item("hw25_chair_obj_reward");
  setProgress(f, { stage: STAGE.COMPLETE });
  f.player.setAttribute("holiday-rewards:unlocked", ["hw25_chair_obj_reward"]);
  f.player.getInventory().setItem(0, new core.Item(chair, 1));
  dropChair(f, chair);
  assert.equal(f.player.getInventory().getAmount(chair), 0);
  f.player.getInventory().add(new core.Item(chair, 1)); // Diango's retrieval: nothing owned, so it hands one out
  for (let tick = 0; tick < 21; tick++) core.TaskManager.process();
  assert.equal(f.player.getInventory().getAmount(chair), 1);
  dropChair(f, chair);
  f.player.getInventory().add(new core.Item(chair, 1));
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(f.player.getInventory().getAmount(chair), 1, "logging out with one following keeps one");
});

test("a judging conversation closed early also ends the cutscene", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t), fred = npc("fred_the_farmer", 3189, 3273);
  setProgress(f, { stage: STAGE.LANTERN, briefed: true, picture: true, chair: true, scarecrow: true, lamp: true, quiz: 31 });
  dressForContest(f);
  assert.ok(PM.emitNpcInteraction({ player: f.player, npc: fred, clickType: 1, option: 1 }));
  for (let step = 0; step < 4; step++) { seeNearbyNpcs(f.player); await resume(f, 1); }
  const death = core.CacheDefinitions.getArchivedId("halloween-2025", "npc", "hw25_deadth_cs");
  const actors = () => [...core.World.getNpcs()].filter(npc => npc?.getId() === death && npc.getOwner() === f.player).length;
  assert.equal(actors(), 1, "the cutscene has started");
  f.player.getDialogueManager().reset();
  f.player.getPacketSender().sendInterfaceRemoval();
  tick(4);
  assert.equal(actors(), 0);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(stage(f), STAGE.LANTERN, "judging again later still works");
});

test("clicking another NPC mid-conversation leaves the event conversation intact", async t => {
  setActive(true);
  t.after(() => setActive(false));
  const f = fixture(t), seth = npc("favour_seth_groats", 3228, 3291);
  setProgress(f, { stage: STAGE.STARTED });
  f.player.setLocation(new core.Location(3228, 3292, 0));
  assert.ok(PM.emitNpcInteraction({ player: f.player, npc: seth, clickType: 1, option: 1 }));
  await resume(f, 1);
  PM.emitNpcInteraction({ player: f.player, npc: npc("cow", 3229, 3292), clickType: 2, option: 2 });
  await converse(f);
  assert.equal(stage(f), STAGE.COLLECTING);
  assert.equal(f.player.getInventory().getAmount(item("hw25_spooky_painting")), 1);
});

test("rewards that stack onto held stacks are not counted as missing slots", async t => {
  setActive(true);
  t.after(() => setActive(false));
  lifetime = 86400;
  t.after(() => { lifetime = 0; });
  const f = fixture(t), fred = npc("fred_the_farmer", 3189, 3273);
  setProgress(f, { stage: STAGE.JUDGED, briefed: true, picture: true, chair: true, scarecrow: true, lamp: true, quiz: 31 });
  dressForContest(f);
  for (const [slot, symbol] of ["cert_pumpkin", "cert_halloweenmask_red", "cert_halloweenmask_green", "cert_halloweenmask_blue"].entries()) {
    f.player.getInventory().setItem(slot, new core.Item(core.CacheDefinitions.getObjId(symbol), 1));
  }
  for (let slot = 4; slot < 25; slot++) f.player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  await talk(f, fred, [1]);
  assert.equal(stage(f), STAGE.JUDGED);
  assert.ok(f.messages.includes("You need 1 free inventory slot to receive your Halloween event rewards."), f.messages.slice(-2).join(" | "));
});
