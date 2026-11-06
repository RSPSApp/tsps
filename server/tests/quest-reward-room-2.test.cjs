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
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const SYMBOL = 4683;
const DIG = "the_dig_site";
const ICTH = "ictlharins_little_helper";
const CURSE = "curse_of_arrav";
const BIT_LEVER_NORTH_PULLED = 1 << 7;
const SKELETON_NOTHING = "You search the skeleton, but find nothing of interest.";
const SHELVES_NOTHING = "You search the shelves, but find nothing of interest.";
const NO_REACH = "You can't reach that!";

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
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
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
  return { p, c, inv: p.getInventory(), messages };
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

test("Dig Site: the student refuses a full bag and the exam waits; with room he signs", async (t) => {
  const control = actor(t, DIG, 1);
  await talk(t, control, N.STUDENT);
  assert.equal(control.inv.getAmount(I.LEVEL_1_CERTIFICATE), 1, "control: the certificate");
  assert.equal(stageOf(control, DIG), 2, "control: and the stage");

  const f = actor(t, DIG, 1);
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
