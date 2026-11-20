// node --test tests/darkness-of-hallowvale-sketches.test.cjs
//
// Darkness of Hallowvale, stages 180-250 (the Sketches unit) against the live capture (revision 242;
// ticks in the unit's comments): Veliaf and Vertida after Roald, the lead to the wall, the rocky
// surface, barricade, ladders and wall shortcut, Safalaan's supplies, the three sketches on their
// marked tiles, the western scene, Vanstrom's ambush and knockout, Sarius, lost sketches and the
// Look-at interfaces. Real plugins, real Players and NPCs, the real dialogue runtime and tasks;
// clicks go through PluginManager's own emitters. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { STAGE, VARBIT, impliedVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

const STAGE_ATTRIBUTE = "quest.darkness_of_hallowvale.stage";
const CHARCOAL = 973, PAPYRUS = 970, SKETCH_1 = 9646, SKETCH_2 = 9647, SKETCH_3 = 9648;
const MESBOX = 229, OBJECTBOX_DOUBLE = 11;
const NORTH = [3556, 3379], WEST = [3522, 3357], SOUTH = [3572, 3331];
let core;
let next = 7100;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3556, 3379], [3522, 3357], [3572, 3331], [3589, 3214], [3596, 3203], [3632, 9643], [3595, 3310]]) {
    core.RegionManager.loadMapFiles(x, y);
  }
  PM.emitServerStartup({});
});

function actor(t, stage, x, y, z = 0, extra = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("dohsk" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  const varbits = new Map(), sounds = [], chatboxes = [], messages = [], interfaces = [], configs = new Map(), hits = [];
  const sender = player.getPacketSender();
  const wrap = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendVarbit", (id, value) => varbits.set(id, value));
  wrap("sendSound", (id) => sounds.push(id));
  wrap("sendChatboxInterface", (id) => chatboxes.push(id));
  wrap("sendInterface", (id) => interfaces.push(id));
  wrap("sendConfig", (id, value) => configs.set(id, value));
  const anims = [];
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { anims.push(animation.getId()); return perform(animation); };
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { messages.push(String(text)); return sendMessage(text); };
  const queue = player.getCombat().getHitQueue();
  const addPending = queue.addPendingDamage.bind(queue);
  queue.addPendingDamage = (list) => { for (const hit of list) hits.push(hit.getDamage()); return addPending(list); };
  player.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  player.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(stage), ...extra });
  player.setAttribute(STAGE_ATTRIBUTE, stage);
  for (const [id, value] of Object.entries(player.getAttribute(VARS_ATTRIBUTE))) sender.sendVarbit(Number(id), value);
  sender.sendVarbit(VARBIT.QUEST, stage);
  players.push(player);
  const npcs = [];
  t.after(() => {
    player.getDialogueManager().reset?.();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
    for (const npc of npcs) if (npc?.isRegistered?.()) PM.removeNpc(npc);
  });
  const spawn = (id, nx, ny, nz = 0) => {
    const npc = PM.spawnNpc({ id, x: nx, y: ny, z: nz, wanderRadius: 0 }, "DohSketchesTest");
    npcs.push(npc);
    return npc;
  };
  return { player, varbits, sounds, chatboxes, messages, interfaces, configs, anims, hits, spawn };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

const stageOf = (player) => player.getAttribute(STAGE_ATTRIBUTE);
const saved = (player, id) => Number(player.getAttribute(VARS_ATTRIBUTE)?.[id]) || 0;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const current = (player) => player.getDialogueManager().getCurrent();
const text = (player) => current(player)?.getText?.() ?? null;
const head = (player) => current(player)?.getNpcId?.() ?? null;
const cont = (player) => player.getDialogueManager().advance();
function continueUntil(player, predicate, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (predicate(text(player) ?? "")) return true;
    cont(player);
  }
  return predicate(text(player) ?? "");
}
function choose(player, option) {
  const pending = core.MultiChatboxPrompt.getPending(player);
  assert.ok(pending, `a menu is open for "${option}"`);
  const index = pending.options.indexOf(option);
  assert.ok(index >= 0, `"${option}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: index + 1 });
}
function talk(player, npc) {
  const npcId = npc.getContentId(player);
  return PM.emitNpcInteraction({ player, npc, npcId, npcIndex: npc.getIndex(), clickType: 1,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() }, handled: false });
}
function objectClick(player, id, [x, y, z], option) {
  const definition = core.ObjectDefinition.forPlayer(id, player) ?? core.ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((entry) => entry === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} has ${option}`);
  return PM.emitObjectInteraction({ player, object: { getId: () => id, getLocation: () => new core.Location(x, y, z) },
    objectId: id, definition, clickType, option, location: { x, y, z }, sourceLocation: { x, y, z }, handled: false });
}
function giveSupplies(player, papyrus = 3) {
  const inventory = player.getInventory();
  inventory.set(14, new core.Item(CHARCOAL, 1));
  for (let i = 0; i < papyrus; i++) inventory.set(15 + i, new core.Item(PAPYRUS, 1));
}
function sketch(player, papyrusSlot = 17) {
  const inventory = player.getInventory();
  return PM.emitItemOnItem({ player, usedItem: inventory.getItems()[14], usedItemId: CHARCOAL, usedItemSlot: 14,
    usedWithItem: inventory.getItems()[papyrusSlot], usedWithItemId: PAPYRUS, usedWithItemSlot: papyrusSlot, handled: false });
}
const slotItem = (player, slot) => player.getInventory().getItems()[slot]?.getId?.() ?? -1;
function owned(player, id) {
  return [...core.World.getNpcs()].filter((npc) => npc?.isRegistered?.() && npc.getOwner?.() === player
    && (npc.getId() === id || npc.getNpcTransformationId?.() === id));
}

// ---------------------------------------------------------------------------

test("Veliaf after Roald: the capture's re-talk at 180, the post-Safalaan words from 200", (t) => {
  const a = actor(t, STAGE.SENT_BACK, 3494, 9629);
  const veliaf = a.spawn(8277, 3494, 9628);
  assert.equal(talk(a.player, veliaf), true);
  assert.equal(text(a.player), "Well met, friend.");
  const b = actor(t, STAGE.NORTH_SKETCHED, 3494, 9629);
  const veliaf2 = b.spawn(8277, 3494, 9628);
  assert.equal(talk(b.player, veliaf2), true);
  assert.ok(text(b.player).startsWith("Well met,"));
  cont(b.player);
  assert.equal(text(b.player), "Hello, Veliaf. I'm doing some work for the Sanguinesti Myreque.");
  const c = actor(t, STAGE.SEALED_MESSAGE, 3494, 9629);
  const veliaf3 = c.spawn(8277, 3494, 9628);
  talk(c.player, veliaf3);
  assert.notEqual(text(c.player), "Hello, Veliaf. I'm doing some work for the Sanguinesti Myreque.", "310 is the Lab unit's");
});

test("Vertida at 180: 190 and 2592 = 1 as 'He's very distinctive...' shows; the lead lands upstairs at 3596,3203,1", (t) => {
  const a = actor(t, STAGE.SENT_BACK, 3632, 9644);
  const vertida = a.spawn(3773, 3633, 9643);
  assert.equal(talk(a.player, vertida), true);
  assert.equal(text(a.player), "Hello there.");
  assert.ok(continueUntil(a.player, (line) => line.startsWith("Okay, great, that's helpful.")));
  assert.equal(stageOf(a.player), STAGE.SENT_BACK);
  cont(a.player);
  assert.ok(text(a.player).startsWith("He's very distinctive."));
  assert.equal(stageOf(a.player), STAGE.SAFALAAN_DESCRIBED, "190 (t5999)");
  assert.equal(saved(a.player, VARBIT.SAFALAAN_VISIBLE), 1);
  for (let i = 0; i < 4 && !core.MultiChatboxPrompt.getPending(a.player); i++) cont(a.player);
  choose(a.player, "I'll make my own way.");
  assert.equal(text(a.player), "I'll make my own way.");
  cont(a.player);
  assert.equal(text(a.player), "I'll be here if you change your mind.");
  assert.equal(stageOf(a.player), STAGE.SAFALAAN_DESCRIBED, "190 stands whichever way is picked");
});

test("the lead: the held box, the move on the third tick, the continue on the fourth (t6005-6009)", (t) => {
  const a = actor(t, STAGE.SAFALAAN_DESCRIBED, 3632, 9644);
  const vertida = a.spawn(3773, 3633, 9643);
  assert.equal(talk(a.player, vertida), true);
  assert.equal(text(a.player), "Hello there. What do I need to do now?", "the again briefing at 190");
  for (let i = 0; i < 10 && !core.MultiChatboxPrompt.getPending(a.player); i++) cont(a.player);
  choose(a.player, "Okay, lead the way.");
  assert.equal(text(a.player), "Okay, lead the way.");
  cont(a.player);
  assert.equal(a.chatboxes.at(-1), MESBOX);
  tick(2);
  assert.deepEqual(at(a.player), [3632, 9644, 0]);
  tick(1);
  assert.deepEqual(at(a.player), [3596, 3203, 1], "upstairs west of Trader Sven (t6008)");
  tick(1);
  assert.equal(a.varbits.get(6719), 0, "minimap back");
});

test("the rocky surface's messagebox unlocks the barricade; it opens for a step through and shuts two ticks on", (t) => {
  const a = actor(t, STAGE.SAFALAAN_DESCRIBED, 3589, 3214);
  const calls = [];
  const sender = a.player.getPacketSender();
  const sendObject = sender.sendObject.bind(sender);
  sender.sendObject = (object) => { calls.push(object.getId()); return sendObject(object); };
  assert.equal(objectClick(a.player, 18054, [3589, 3215, 0], "Open"), true);
  assert.equal(a.chatboxes.at(-1), MESBOX, "stuck fast first");
  assert.ok(text(a.player).startsWith("You try to open it"));
  a.player.getDialogueManager().reset();
  assert.equal(objectClick(a.player, 18056, [3592, 3211, 0], "Search"), true);
  tick(1);
  assert.ok(text(a.player).startsWith("You notice that the rocks seem to move."));
  cont(a.player);
  assert.equal(objectClick(a.player, 18054, [3589, 3215, 0], "Open"), true);
  tick(1);
  assert.deepEqual(calls, [38848, 18055], "inviswall + inactive barricade (t6115)");
  assert.ok(a.sounds.includes(62));
  tick(1);
  assert.deepEqual(at(a.player), [3589, 3215, 0], "stepped through");
  tick(1);
  assert.equal(calls.at(-1), 18054, "shut again (t6117)");
});

test("the wall ladders and the Drakan wall shortcut use live's tiles and anims", (t) => {
  const a = actor(t, STAGE.SAFALAAN_DESCRIBED, 3588, 3209, 1);
  assert.equal(objectClick(a.player, 17999, [3588, 3210, 1], "Climb-down"), true);
  assert.deepEqual(a.anims, [827]);
  tick(1);
  assert.deepEqual(at(a.player), [3588, 3211, 0], "t6100");
  a.player.moveTo(new core.Location(3592, 3230, 0));
  tick(1);
  objectClick(a.player, 18000, [3593, 3230, 0], "Climb-up");
  tick(1);
  assert.deepEqual(at(a.player), [3594, 3230, 1], "t6128");
  a.player.moveTo(new core.Location(3595, 3310, 1));
  tick(1);
  assert.equal(objectClick(a.player, 39173, [3595, 3310, 1], "Climb-up"), true);
  assert.equal(a.anims.at(-1), 828);
  tick(1);
  assert.deepEqual(at(a.player), [3595, 3312, 0], "t6191");
});

test("Safalaan: 195 on 'Ah, Veliaf!', the double object box, then the supplies and 200 on 'Good luck...'", (t) => {
  const a = actor(t, STAGE.SAFALAAN_DESCRIBED, 3585, 3331);
  const safalaan = a.spawn(6159, 3584, 3331);
  assert.equal(talk(a.player, safalaan), true);
  assert.ok(text(a.player).startsWith("You must be Safalaan."));
  assert.ok(continueUntil(a.player, (line) => line.startsWith("Ah, Veliaf!")));
  assert.equal(stageOf(a.player), STAGE.SAFALAAN_MET, "195 (t6221)");
  assert.equal(head(a.player), 6159, "the world multinpc's head (t6208)");
  assert.ok(continueUntil(a.player, (line) => line.startsWith("Safalaan gives you some charcoal and papyrus.")));
  assert.equal(a.chatboxes.at(-1), OBJECTBOX_DOUBLE);
  assert.equal(a.player.getInventory().getAmount(CHARCOAL), 0, "nothing handed over with the box");
  cont(a.player);
  assert.equal(stageOf(a.player), STAGE.SAFALAAN_MET);
  cont(a.player);
  assert.ok(text(a.player).startsWith("Good luck, my friend."));
  assert.equal(stageOf(a.player), STAGE.SKETCHING, "200 (t6409)");
  assert.equal(a.player.getInventory().getAmount(CHARCOAL), 1);
  assert.equal(a.player.getInventory().getAmount(PAPYRUS), 3);
  talk(a.player, safalaan);
  assert.equal(text(a.player), "Hello again!", "the re-talk at 200");
});

test("the north sketch: turned south on the tile, the pen a tick on, sketch 1 in the papyrus' slot, 210 and 2592 = 2", (t) => {
  const a = actor(t, STAGE.SKETCHING, ...NORTH);
  giveSupplies(a.player);
  assert.equal(sketch(a.player, 17), true);
  assert.deepEqual(a.anims, []);
  tick(1);
  assert.ok(a.messages.includes("You start sketching..."));
  assert.deepEqual(a.anims, [909]);
  assert.ok(a.sounds.includes(1723));
  tick(1);
  assert.equal(slotItem(a.player, 17), PAPYRUS);
  tick(1);
  assert.equal(slotItem(a.player, 17), SKETCH_1, "same slot (t6493)");
  assert.ok(a.messages.some((line) => /sketch of the northern approach\.$/.test(line)));
  assert.equal(stageOf(a.player), STAGE.NORTH_SKETCHED);
  assert.equal(saved(a.player, VARBIT.SAFALAAN_VISIBLE), 2);
  assert.equal(sketch(a.player, 16), true);
  assert.ok(a.messages.at(-1).startsWith("You already have a sketch of the castle from this angle"));
});

test("off the marked tile charcoal on papyrus is not a sketch; out of order the player says why", (t) => {
  const a = actor(t, STAGE.SKETCHING, NORTH[0] + 1, NORTH[1]);
  giveSupplies(a.player);
  assert.equal(sketch(a.player), false);
  const b = actor(t, STAGE.SKETCHING, ...WEST);
  giveSupplies(b.player);
  assert.equal(sketch(b.player), true);
  assert.equal(text(b.player), "Safalaan asked me to sketch the north side first.");
  const c = actor(t, STAGE.NORTH_SKETCHED, ...SOUTH);
  giveSupplies(c.player);
  sketch(c.player);
  assert.equal(text(c.player), "I need to make a sketch of the western face of the castle.");
});

test("the western scene: the copy, the cast, the heads in each form, the take-off, then 220 and sketch 2", (t) => {
  const a = actor(t, STAGE.NORTH_SKETCHED, ...WEST, 0, { [VARBIT.SAFALAAN_VISIBLE]: 2 });
  giveSupplies(a.player);
  a.player.getInventory().set(17, new core.Item(SKETCH_1, 1));
  assert.equal(sketch(a.player, 15), true);
  tick(5);
  assert.equal(a.varbits.get(542), 1, "cutscene_status (t6534)");
  assert.equal(a.configs.get(5588), 1);
  tick(1);
  assert.notDeepEqual(at(a.player), [...WEST, 0], "in the copy (t6535)");
  tick(2);
  const cast = owned(a.player, 3733).concat(owned(a.player, 3740), owned(a.player, 3744), owned(a.player, 3700));
  assert.equal(cast.length, 4, "Vanstrom, Vanescula, Ranis and the tray juvinate (t6537)");
  tick(2);
  assert.ok(text(a.player).startsWith("So yes, Lady Vanescula"));
  assert.equal(head(a.player), 3733);
  assert.ok(continueUntil(a.player, (line) => line.startsWith("Mmm, delicious!")));
  const vanescula = owned(a.player, 3740)[0];
  cont(a.player);
  tick(3);
  assert.equal(vanescula.getNpcTransformationId(), 3741, "grounded (t6576)");
  tick(4);
  assert.equal(text(a.player), "But we really have to get on.");
  assert.equal(head(a.player), 3741);
  cont(a.player);
  tick(3);
  assert.equal(text(a.player), "The same is true for me, m'lady.");
  assert.equal(head(a.player), 3734);
  cont(a.player);
  tick(13);
  assert.equal(stageOf(a.player), STAGE.NORTH_SKETCHED);
  tick(1);
  assert.equal(stageOf(a.player), STAGE.WEST_SKETCHED, "220 as it fades (t6601)");
  assert.equal(slotItem(a.player, 15), SKETCH_2);
  assert.equal(vanescula.getNpcTransformationId(), 3742, "flying");
  tick(2);
  assert.deepEqual(at(a.player), [...WEST, 0], "back on the map (t6603)");
  assert.equal(a.varbits.get(542), 0);
  assert.equal(owned(a.player, 3742).length, 0, "the cast is gone");
});

function intoAmbush(t, extraVars = {}) {
  const a = actor(t, STAGE.WEST_SKETCHED, ...SOUTH, 0, { [VARBIT.SAFALAAN_VISIBLE]: 2, ...extraVars });
  giveSupplies(a.player);
  a.player.getInventory().set(17, new core.Item(SKETCH_1, 1));
  a.player.getInventory().set(15, new core.Item(SKETCH_2, 1));
  assert.equal(sketch(a.player, 16), true);
  tick(8);
  const vanstrom = owned(a.player, 3736)[0];
  assert.ok(vanstrom, "Vanstrom's scene form at 3583,3331 (t6660)");
  tick(8);
  assert.equal(text(a.player), `Ha! So we meet again, ${a.player.getUsername()}. Prepare to die!`.replace(/ +/g, " "));
  assert.equal(head(a.player), 3735, "his attack form's head (t6668)");
  assert.ok(a.sounds.includes(1192));
  return { ...a, vanstrom };
}

test("the southern ambush is reached at 220 (the old plugin skipped it): 230 past 'Prepare to die!', five attacks 8 ticks apart", (t) => {
  const a = intoAmbush(t);
  assert.equal(stageOf(a.player), STAGE.WEST_SKETCHED);
  cont(a.player);
  assert.equal(stageOf(a.player), STAGE.VANSTROM_ATTACKS, "230 (t6677)");
  assert.equal(a.varbits.get(542), 0, "control back for the fight");
  assert.equal(a.vanstrom.getNpcTransformationId(), 3735);
  const before = a.anims.length;
  tick(2);
  assert.equal(a.hits.length, 1, "the first attack (t6679)");
  tick(8 * 4);
  assert.equal(a.hits.length, 5, "five attacks (t6679-6711)");
  assert.ok(a.hits.every((damage) => damage >= 0 && damage <= 16));
  assert.ok(a.anims.slice(before).includes(4718), "the knockout");
  tick(9);
  assert.deepEqual(owned(a.player, 3778).length, 1, "Sarius in the knockout copy (t6718)");
  tick(4);
  assert.ok(text(a.player).startsWith("Sorry for the interruption, Lord Vanstrom"));
  assert.equal(head(a.player), 3776);
  cont(a.player);
  assert.ok(text(a.player).startsWith("I take no orders from food sacks"));
  cont(a.player);
  assert.equal(stageOf(a.player), STAGE.SARIUS_SAVED, "240 (t6739)");
  assert.equal(saved(a.player, VARBIT.SARIUS_VISIBLE), 1);
  tick(2);
  assert.deepEqual(at(a.player), [...SOUTH, 0], "back on the map (t6741)");
  assert.equal(owned(a.player, 6161).length, 1, "Sarius 6161 at 3576,3331");
  tick(4);
  assert.equal(text(a.player), "Awaken! There are things for you to know.", "no Talk-to needed (t6745)");
  assert.equal(head(a.player), 6161);
  assert.ok(continueUntil(a.player, (line) => line.startsWith("And now be away")));
  assert.equal(stageOf(a.player), STAGE.SARIUS_TALKED, "250 before the third sketch (t6776)");
  assert.equal(slotItem(a.player, 16), PAPYRUS, "the papyrus is still unused");
  cont(a.player);
  tick(3);
  assert.equal(saved(a.player, VARBIT.SARIUS_VISIBLE), 0, "t6783");
  assert.equal(owned(a.player, 6161).length, 0);
  tick(2);
  assert.equal(sketch(a.player, 16), true);
  tick(3);
  assert.equal(slotItem(a.player, 16), SKETCH_3, "sketch 3 at 250 (t6789)");
  assert.equal(stageOf(a.player), STAGE.SARIUS_TALKED);
});

test("Protect from Melee stops all of Vanstrom's damage (the Wiki)", (t) => {
  const a = intoAmbush(t);
  a.player.setPrayerActive?.(core.PrayerHandler.PROTECT_FROM_MELEE, true);
  if (!a.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE]) a.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE] = true;
  cont(a.player);
  tick(2 + 8 * 4);
  assert.deepEqual(a.hits, [0, 0, 0, 0, 0]);
});

test("a lost sketch is made again on its tile without moving the stage", (t) => {
  const a = actor(t, STAGE.WEST_SKETCHED, ...NORTH, 0, { [VARBIT.SAFALAAN_VISIBLE]: 2 });
  giveSupplies(a.player, 1);
  assert.equal(sketch(a.player, 15), true);
  tick(3);
  assert.equal(slotItem(a.player, 15), SKETCH_1);
  assert.equal(stageOf(a.player), STAGE.WEST_SKETCHED);
});

test("Look-at opens each sketch's own interface (t6871-6881)", (t) => {
  const a = actor(t, STAGE.SARIUS_TALKED, 3600, 3300);
  const inventory = a.player.getInventory();
  inventory.set(0, new core.Item(SKETCH_1, 1));
  inventory.set(1, new core.Item(SKETCH_2, 1));
  inventory.set(2, new core.Item(SKETCH_3, 1));
  for (const [slot, id] of [[0, SKETCH_1], [1, SKETCH_2], [2, SKETCH_3]]) {
    PM.emitItemAction({ player: a.player, interfaceId: 149, item: inventory.getItems()[slot], itemId: id, slot, clickType: 1, handled: false });
  }
  assert.deepEqual(a.interfaces, [455, 457, 456]);
});
