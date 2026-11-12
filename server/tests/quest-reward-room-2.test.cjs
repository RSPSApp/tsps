// Run after `yarn build`: node --test tests/quest-reward-room-2.test.cjs
//
// Quest steps that dead-end on a full inventory, or on a dropped item, by real packet.
// - Curse of Arrav: rsprox 3168 t6402-t6448 and t9133-t9136. Live goes by whether the item is held: a
//   skeleton re-gives after a drop, and says "nothing of interest" while it is held.
// - Dig Site: the Wiki has no certificate check at Terry Balando, so a lost certificate can't stop him.
// - Icthlarin's symbol: refused before the jump, as a drop would land on the far side of the pit.
// - Eagles' Peak: the step frees 3 slots and gives 4 items, inside a dialogue, so the last goes to the ground.
// No capture shows a full bag at any of these: refusal wording is ours.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { encodeWidgetSetAnimation } = require("../dist/net/protocol/ClientProtocol");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { JsonPlayerPersistence } = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const HOME = [3222, 3218];
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const SYMBOL = 4683;
const DIG = "the_dig_site";
const ICTH = "ictlharins_little_helper";
const CURSE = "curse_of_arrav";
const BIT_LEVER_NORTH_PULLED = 1 << 7;
const SKELETON_NOTHING = "You search the skeleton, but find nothing of interest.";
const SHELVES_NOTHING = "You search the shelves, but find nothing of interest.";
const NO_REACH = "I can't reach that!";

let core;
let I;
let N;
let O;
let next = 9500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  O = core.ObjectIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => {
  const found = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
  assert.ok(found, `quest ${key} is registered`);
  return found;
};

function actor(t, key, stage) {
  const outboundPackets = [];
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: (packet) => { outboundPackets.push(Buffer.from(packet)); return true; },
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("roomfix" + p.getIndex());
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
  quest(key).setStage(p, stage);
  return { p, c, inv: p.getInventory(), messages, outboundPackets };
}

const stageOf = (f, key) => quest(key).getStage(f.p);
const put = (f, id, slot, amount = 1) => f.inv.setItem(slot, new core.Item(id, amount));

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), 0, "control: the bag is full");
}

function freeSlot(f) {
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === I.RAKE), new core.Item(-1, 0));
  f.inv.refreshItems();
}

function drop(f, id) {
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === id), new core.Item(-1, 0));
  f.inv.refreshItems();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const anyRoomMessage = (f) => f.messages.some((text) => /enough (inventory space|room)/.test(text));

/** Plays what's open, answering menus from `answers`; stops at a menu it has no answer for. */
async function playChat(f, answers = []) {
  const queue = [...answers];
  for (let i = 0; i < 120; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const choice = menu.options.findIndex((option) => queue[0] !== undefined && option.startsWith(queue[0]));
      if (choice < 0) return;
      queue.shift();
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    const manager = f.p.getDialogueManager();
    if (!manager.isActive()) {
      ticks(f, 2);
      if (!manager.isActive() && !core.MultiChatboxPrompt.getPending(f.p)) return;
      continue;
    }
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (!(manager.getCurrent() instanceof ActionDialogue) && group in CONTINUE_CHILD) {
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
    }
    ticks(f, 1);
  }
}

async function talk(t, f, npcId, answers) {
  f.p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  const npc = core.NPC.create(npcId, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const actions = npc.getCurrentDefinition(f.p).getActions();
  const index = actions.findIndex((action) => action === "Talk-to");
  assert.ok(index >= 0, `control: ${npcId} has Talk-to: ${JSON.stringify(actions)}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  ticks(f, 3);
  await playChat(f, answers);
  f.p.getDialogueManager().reset();
  core.World.getNpcs().remove(npc);
}

/** A loc on a test tile, clicked by packet. Its cache access mask can refuse a side, so this tries each. */
async function clickLoc(t, f, id) {
  const at = new core.Location(HOME[0] + 1, HOME[1], 0);
  const loc = new core.GameObject(id, at, 10, 0);
  MapObjects.add(loc);
  t.after(() => MapObjects.remove(loc));
  for (const [dx, dy] of [[0, 0], [2, 0], [1, 1], [1, -1]]) {
    f.p.setLocation(new core.Location(HOME[0] + dx, HOME[1] + dy, 0));
    f.messages.length = 0;
    await send(f, { type: "object_option", id, x: at.getX(), y: at.getY(), clickType: 1 });
    ticks(f, 12);
    await playChat(f);
    f.p.getDialogueManager().reset();
    if (!f.messages.includes(NO_REACH)) break;
  }
  MapObjects.remove(loc);
}

// ------------------------------------------------------------------ The Dig Site

test("Dig Site: the teddy bush works and giving the guide tea unlocks the native panning route", async (t) => {
  const f = actor(t, DIG, 1);
  core.RegionManager.loadMapFiles(3357, 3372);
  f.p.setLocation(new core.Location(3357, 3371, 0));
  await send(f, { type: "object_option", id: O.BUSH_10, x: 3357, y: 3372, action: "Search" });
  ticks(f, 5);
  assert.equal(f.inv.getAmount(I.TEDDY), 1);
  f.p.getDialogueManager().reset();
  await send(f, { type: "object_option", id: O.BUSH_10, x: 3357, y: 3372, action: "Search" });
  ticks(f, 5);
  assert.equal(f.inv.getAmount(I.TEDDY), 1, "the same player cannot collect a second teddy while holding one");

  f.p.setLocation(new core.Location(3378, 3377, 0));
  const guide = core.NPC.create(N.PANNING_GUIDE, new core.Location(3377, 3377, 0));
  core.World.getNpcs().add(guide);
  t.after(() => core.World.getNpcs().remove(guide));
  put(f, I.PANNING_TRAY, 1);
  const pan = async () => {
    await send(f, { type: "object_option", id: O.PANNING_POINT, x: 3379, y: 3377, action: "Pan" });
    ticks(f, 8);
  };
  await pan();
  assert.equal(f.inv.getAmount(I.PANNING_TRAY), 1, "the unpaid guide stops the pan");
  f.p.getDialogueManager().reset();

  put(f, I.CUP_OF_TEA_2, 2);
  put(f, I.CUP_OF_TEA_2, 3);
  const tea = async (slot) => {
    await send(f, { type: "item_on_npc", targetIndex: guide.getIndex(), itemId: I.CUP_OF_TEA_2, slot, widgetId: 3214 });
    ticks(f, 5);
    f.p.getDialogueManager().reset();
  };
  await tea(2);
  assert.equal(f.inv.forSlot(2).getId(), -1);
  assert.equal(f.inv.getAmount(I.CUP_OF_TEA_2), 1, "the clicked cup is handed over");
  assert.equal(f.p.getPacketSender().getVarbit(2544), 1);
  await tea(3);
  assert.equal(f.inv.getAmount(I.CUP_OF_TEA_2), 1, "one tea permanently buys access");
  await pan();
  assert.equal(f.inv.getAmount(I.PANNING_TRAY_3), 1, "the real panning point fills the tray");
  f.p.getDialogueManager().reset();

  t.mock.method(Math, "random", () => 17 / 40);
  await send(f, { type: "inventory_action", slot: 1, itemId: I.PANNING_TRAY_3, widgetId: 3214, option: "Search" });
  assert.equal(f.inv.getAmount(I.PANNING_TRAY), 1, "searching empties the tray");
  assert.equal(f.inv.getAmount(I.SPECIAL_CUP), 1, "the quest cup can be found");
});

test("Dig Site: panning refusals use player chat and nuggets show the gold tray box", async (t) => {
  const empty = actor(t, DIG, 0);
  put(empty, I.PANNING_TRAY, 0);
  empty.outboundPackets.length = 0;
  await send(empty, { type: "inventory_action", slot: 0, itemId: I.PANNING_TRAY, widgetId: 3214, option: "Search" });
  await new Promise((resolve) => setImmediate(resolve));
  let dialogue = empty.p.getDialogueManager().getCurrent();
  assert.ok(dialogue instanceof PlayerDialogue);
  assert.equal(dialogue.getText(), "Err, why am I searching an empty tray?");
  const playerHead = (217 << 16) | 2;
  const emptyTrayExpression = encodeWidgetSetAnimation(playerHead, 554);
  assert.ok(empty.outboundPackets.some((packet) => packet.includes(emptyTrayExpression)), "native player head receives chatquiz1 (554)");
  await send(empty, { type: "dialogue_continue", widgetId: (217 << 16) | 5, childIndex: -1 });
  assert.equal(empty.p.getDialogueManager().isActive(), false, "the native player-chat continue packet closes the line");

  const full = actor(t, DIG, 0);
  full.p.setAttribute("dig-site:panning-permission", true);
  core.RegionManager.loadMapFiles(3378, 3377);
  full.p.setLocation(new core.Location(3378, 3377, 0));
  put(full, I.PANNING_TRAY_3, 0);
  full.outboundPackets.length = 0;
  await send(full, { type: "object_option", id: O.PANNING_POINT, x: 3379, y: 3377, action: "Pan" });
  ticks(full, 8);
  await new Promise((resolve) => setImmediate(resolve));
  dialogue = full.p.getDialogueManager().getCurrent();
  assert.ok(dialogue instanceof PlayerDialogue);
  assert.equal(dialogue.getText(), "I already have a full panning tray; perhaps I should<br>search it first.");
  const fullTrayExpression = encodeWidgetSetAnimation(playerHead, 576);
  assert.ok(full.outboundPackets.some((packet) => packet.includes(fullTrayExpression)), "native player head receives chatcon2 (576)");

  const nuggets = actor(t, DIG, 0);
  put(nuggets, I.PANNING_TRAY_3, 0);
  t.mock.method(Math, "random", () => 5 / 40);
  await send(nuggets, { type: "inventory_action", slot: 0, itemId: I.PANNING_TRAY_3, widgetId: 3214, option: "Search" });
  dialogue = nuggets.p.getDialogueManager().getCurrent();
  assert.ok(dialogue instanceof ItemStatementDialogue);
  assert.equal(dialogue.getItemId(), I.PANNING_TRAY_2, "the objectbox shows tray_gold (678)");
  assert.equal(dialogue.getText(), "You find some gold nuggets within the mud.");
  assert.equal(nuggets.inv.getAmount(I.NUGGETS), 1, "the reward remains gold nuggets (680)");
  assert.equal(nuggets.inv.getAmount(I.PANNING_TRAY_3), 0, "the searched mud tray is consumed");
});

async function reloadDigSite(t, original) {
  const directory = mkdtempSync(path.join(tmpdir(), "tsps-digsite-"));
  const previousDirectory = JsonPlayerPersistence.SAVE_DIRECTORY;
  JsonPlayerPersistence.SAVE_DIRECTORY = directory;
  try {
    const persistence = new JsonPlayerPersistence();
    const username = original.p.getUsername();
    persistence.save(original.p);
    await persistence.flush();

    const saved = new JsonPlayerPersistence().load(username);
    assert.ok(saved);
    const restored = actor(t, DIG, 0);
    restored.p.setUsername(username);
    saved.applyToPlayer(restored.p);
    assert.equal(stageOf(restored, DIG), stageOf(original, DIG));
    return restored;
  } finally {
    JsonPlayerPersistence.SAVE_DIRECTORY = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("Dig Site: the journal remembers the curator's stamp after a stage 1 reload", async (t) => {
  const started = actor(t, DIG, 1);
  put(started, I.UNSTAMPED_LETTER, 0);
  await talk(t, started, N.CURATOR_HAIG_HALEN);

  const restored = await reloadDigSite(t, started);
  assert.equal(restored.inv.getAmount(I.SEALED_LETTER), 1);
  const digSite = quest(DIG);
  assert.match(digSite.buildJournal(restored.p, digSite).join(" "), /curator stamped my letter/);
});

test("Dig Site: the first student signs after a reload following letter delivery", async (t) => {
  const started = actor(t, DIG, 1);
  put(started, I.UNSTAMPED_LETTER, 0);
  await talk(t, started, N.CURATOR_HAIG_HALEN);
  assert.equal(started.inv.getAmount(I.SEALED_LETTER), 1);
  await talk(t, started, N.EXAMINER);
  assert.equal(started.inv.getAmount(I.SEALED_LETTER), 0);

  const restored = await reloadDigSite(t, started);
  await talk(t, restored, N.STUDENT);
  assert.equal(restored.inv.getAmount(I.LEVEL_1_CERTIFICATE), 1);
  assert.equal(stageOf(restored, DIG), 2);
});

test("Dig Site: a legacy save after the first exam still points to the students", async (t) => {
  const digSite = quest(DIG);
  for (const stage of [2, 3]) {
    const restored = await reloadDigSite(t, actor(t, DIG, stage));
    assert.match(digSite.buildJournal(restored.p, digSite).join(" "), /three students/);
  }
});

test("Dig Site: the student refuses a full bag and the exam waits; with room he signs", async (t) => {
  // The students only take part once the examiner has the curator's stamped letter (stage 1).
  const letterDelivered = (f) => { f.p.setAttribute("quest.the_dig_site.letter_delivered", true); return f; };
  const control = letterDelivered(actor(t, DIG, 1));
  await talk(t, control, N.STUDENT);
  assert.equal(control.inv.getAmount(I.LEVEL_1_CERTIFICATE), 1, "control: the certificate");
  assert.equal(stageOf(control, DIG), 2, "control: and the stage");

  const f = letterDelivered(actor(t, DIG, 1));
  fill(f);
  await talk(t, f, N.STUDENT);
  assert.equal(stageOf(f, DIG), 1, "the exam waits");
  assert.ok(anyRoomMessage(f), JSON.stringify(f.messages));
  assert.equal(f.messages.includes("The student signs your certificate."), false, "and isn't signed");
  freeSlot(f);
  await talk(t, f, N.STUDENT);
  assert.equal(f.inv.getAmount(I.LEVEL_1_CERTIFICATE), 1, "with room he signs");
  assert.equal(stageOf(f, DIG), 2);
});

test("Dig Site: Terry doesn't need the certificates, and needs room for the compound", async (t) => {
  const certificates = () => [I.LEVEL_1_CERTIFICATE, I.LEVEL_2_CERTIFICATE, I.LEVEL_3_CERTIFICATE];

  const lost = actor(t, DIG, 4);
  await talk(t, lost, N.TERRY_BALANDO);
  assert.equal(lost.inv.getAmount(I.CHEMICAL_COMPOUND), 1, "no certificates: he still hands it over");
  assert.equal(stageOf(lost, DIG), 7, "and the stage moves");

  const swap = actor(t, DIG, 4);
  certificates().forEach((id, slot) => put(swap, id, slot));
  fill(swap);
  await talk(t, swap, N.TERRY_BALANDO);
  assert.equal(swap.inv.getAmount(I.CHEMICAL_COMPOUND), 1, "control: a full bag holding certificates has room once they go");
  assert.equal(swap.inv.getAmount(I.LEVEL_1_CERTIFICATE), 0, "control: they go, as before");

  const full = actor(t, DIG, 4);
  fill(full);
  await talk(t, full, N.TERRY_BALANDO);
  assert.equal(stageOf(full, DIG), 4, "a full bag with none to free waits");
  assert.ok(anyRoomMessage(full), JSON.stringify(full.messages));
  freeSlot(full);
  await talk(t, full, N.TERRY_BALANDO);
  assert.equal(full.inv.getAmount(I.CHEMICAL_COMPOUND), 1, "with room he hands it over");
});

// ------------------------------------------------------------------ Icthlarin's Little Helper

test("Icthlarin: the pit refuses a full bag before the jump; with room it gives the symbol", async (t) => {
  const control = actor(t, ICTH, 16);
  await clickLoc(t, control, O.PIT);
  assert.equal(control.inv.getAmount(SYMBOL), 1, "control: the symbol");
  assert.equal(stageOf(control, ICTH), 17, "control: and the stage");

  const f = actor(t, ICTH, 16);
  fill(f);
  await clickLoc(t, f, O.PIT);
  assert.equal(stageOf(f, ICTH), 16, "the stage waits");
  assert.ok(anyRoomMessage(f), JSON.stringify(f.messages));
  assert.ok(Math.abs(f.p.getLocation().getX() - HOME[0]) <= 2, "and the player hasn't jumped");
  freeSlot(f);
  await clickLoc(t, f, O.PIT);
  assert.equal(f.inv.getAmount(SYMBOL), 1, "with room it gives it");
  assert.equal(stageOf(f, ICTH), 17);
});

test("Icthlarin: at the next stage a dropped symbol comes back at the pit, and no second one", async (t) => {
  const lost = actor(t, ICTH, 17);
  await clickLoc(t, lost, O.PIT);
  assert.equal(lost.inv.getAmount(SYMBOL), 1, "a dropped symbol comes back");

  const holding = actor(t, ICTH, 17);
  put(holding, SYMBOL, 0);
  await clickLoc(t, holding, O.PIT);
  assert.equal(holding.inv.getAmount(SYMBOL), 1, "control: no second symbol");

  const full = actor(t, ICTH, 17);
  fill(full);
  await clickLoc(t, full, O.PIT);
  assert.equal(full.inv.getAmount(SYMBOL), 0, "control: no room");
  assert.ok(anyRoomMessage(full), JSON.stringify(full.messages));

  const early = actor(t, ICTH, 15);
  await clickLoc(t, early, O.PIT);
  assert.equal(early.inv.getAmount(SYMBOL), 0, "control: none before the ceremony");
});

// ------------------------------------------------------------------ The Curse of Arrav

test("Curse of Arrav: a skeleton's key goes by what is held, as 3168 has it", async (t) => {
  const f = actor(t, CURSE, 4);
  fill(f);
  await clickLoc(t, f, O.SKELETON_136);
  assert.equal(f.messages.includes("You search the skeleton and find a key."), false, "a full bag doesn't find it");
  assert.ok(anyRoomMessage(f), JSON.stringify(f.messages));
  freeSlot(f);
  await clickLoc(t, f, O.SKELETON_136);
  assert.equal(f.inv.getAmount(I.MASTABA_KEY), 1, "with room it gives it");
  await clickLoc(t, f, O.SKELETON_136);
  assert.equal(f.inv.getAmount(I.MASTABA_KEY), 1, "control: no second key");
  assert.ok(f.messages.includes(SKELETON_NOTHING), JSON.stringify(f.messages));
  drop(f, I.MASTABA_KEY);
  await clickLoc(t, f, O.SKELETON_136);
  assert.equal(f.inv.getAmount(I.MASTABA_KEY), 1, "a dropped key comes back");

  const other = actor(t, CURSE, 4);
  await clickLoc(t, other, O.SKELETON_139);
  assert.equal(other.inv.getAmount(I.MASTABA_KEY_2), 1, "control: the other skeleton has the other key");
  drop(other, I.MASTABA_KEY_2);
  await clickLoc(t, other, O.SKELETON_139);
  assert.equal(other.inv.getAmount(I.MASTABA_KEY_2), 1, "and gives it again");

  const spent = actor(t, CURSE, 6);
  spent.p.setAttribute("quest.curse_of_arrav.bits", BIT_LEVER_NORTH_PULLED);
  await clickLoc(t, spent, O.SKELETON_136);
  assert.equal(spent.inv.getAmount(I.MASTABA_KEY), 0, "none once it has turned its lever");
  assert.ok(spent.messages.includes(SKELETON_NOTHING), JSON.stringify(spent.messages));
});

test("Curse of Arrav: the shelves' jar goes by what is held, as 3168 has it", async (t) => {
  const f = actor(t, CURSE, 12);
  fill(f);
  await clickLoc(t, f, O.SHELVES_164);
  assert.equal(stageOf(f, CURSE), 12, "a full bag moves nothing");
  assert.ok(anyRoomMessage(f), JSON.stringify(f.messages));
  freeSlot(f);
  await clickLoc(t, f, O.SHELVES_164);
  assert.equal(f.inv.getAmount(I.CANOPIC_JAR_OIL_), 1, "with room it gives it");
  assert.equal(stageOf(f, CURSE), 14, "and the stage moves");
  await clickLoc(t, f, O.SHELVES_164);
  assert.ok(f.messages.includes(SHELVES_NOTHING), JSON.stringify(f.messages));
  assert.equal(f.inv.getAmount(I.CANOPIC_JAR_OIL_), 1, "control: no second jar");
  drop(f, I.CANOPIC_JAR_OIL_);
  await clickLoc(t, f, O.SHELVES_164);
  assert.equal(f.inv.getAmount(I.CANOPIC_JAR_OIL_), 1, "a dropped jar comes back");

  const onward = actor(t, CURSE, 16);
  put(onward, I.CANOPIC_JAR_FULL_, 0);
  await clickLoc(t, onward, O.SHELVES_164);
  assert.equal(onward.inv.getAmount(I.CANOPIC_JAR_OIL_), 0, "control: none while the filled jar is held");
});

test("Curse of Arrav: the chest's code key waits for room and comes back", async (t) => {
  const f = actor(t, CURSE, 44);
  fill(f);
  await clickLoc(t, f, O.CHEST_237);
  assert.ok(anyRoomMessage(f), JSON.stringify(f.messages));
  assert.equal(f.messages.includes("You unlock the chest and find a code key inside."), false, "a full bag doesn't find it");
  freeSlot(f);
  await clickLoc(t, f, O.CHEST_237);
  assert.equal(f.inv.getAmount(I.CODE_KEY), 1, "with room it gives it");
  await clickLoc(t, f, O.CHEST_237);
  assert.equal(f.inv.getAmount(I.CODE_KEY), 1, "control: no second key");
  drop(f, I.CODE_KEY);
  await clickLoc(t, f, O.CHEST_237);
  assert.equal(f.inv.getAmount(I.CODE_KEY), 1, "a dropped key comes back");
});

// ------------------------------------------------------------------ Eagles' Peak

test("Eagles' Peak: what doesn't fit of the costumes goes to the ground", async (t) => {
  const start = () => {
    const f = actor(t, "eagles_peak", 4);
    f.p.setAttribute("quest.eagles_peak.bits", 1 << 11);
    put(f, I.EAGLE_FEATHER, 0, 10);
    put(f, I.SWAMP_TAR, 1);
    put(f, I.YELLOW_DYE, 2);
    put(f, I.COINS, 3, 100);
    return f;
  };
  const answers = ["I've got the feathers", "Okay, here are the materials"];
  const ground = (f, id) => ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), null);

  const control = start();
  await talk(t, control, N.ASYFF, answers);
  assert.deepEqual([control.inv.getAmount(I.EAGLE_CAPE), control.inv.getAmount(I.FAKE_BEAK)], [2, 2], "control: room");
  assert.equal(ground(control, I.FAKE_BEAK), null, "control: nothing on the ground");

  const f = start();
  fill(f);
  await talk(t, f, N.ASYFF, answers);
  assert.deepEqual([f.inv.getAmount(I.EAGLE_CAPE), f.inv.getAmount(I.FAKE_BEAK)], [2, 1], "control: three slots freed");
  assert.equal(ground(f, I.FAKE_BEAK)?.getItem().getAmount(), 1, "the last beak is on the ground");

  // Leftover feathers and tar keep their slots, so only the dye's frees. Neither is stackable, so each
  // lies as its own item, not one item of amount 2.
  const onGround = (g, id) => ItemOnGroundManager.ownedBy(g.p.getUsername())
    .filter((item) => item.getItem().getId() === id).map((item) => item.getItem().getAmount());
  const tight = start();
  tight.inv.setItem(0, new core.Item(I.EAGLE_FEATHER, 20));
  tight.inv.setItem(1, new core.Item(I.SWAMP_TAR, 2));
  fill(tight);
  await talk(t, tight, N.ASYFF, answers);
  assert.deepEqual([tight.inv.getAmount(I.EAGLE_CAPE), tight.inv.getAmount(I.FAKE_BEAK)], [1, 0], "control: one slot freed");
  assert.deepEqual(onGround(tight, I.EAGLE_CAPE), [1], "the other cape on the ground");
  assert.deepEqual(onGround(tight, I.FAKE_BEAK), [1, 1], "both beaks, each its own item");
});
