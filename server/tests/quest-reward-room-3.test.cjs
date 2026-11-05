// Run after `yarn build`: node --test tests/quest-reward-room-3.test.cjs
//
// Quest items lost to a full inventory or a drop.
// - DT2 mushrooms: rsprox 91 t10587-t10681 and 1703 t10504-t10842 have no cap, with "You don't have enough
//   inventory space for any more mushrooms." and "You pick a mushroom.".
// - The Whisperer's medallion: rsprox 1703 t16262 "You find a medallion amongst the entrails."; the Wiki
//   has a lost one recovered there, and 1703 t16397 has it missing as the story in the last chapter.
// - Fenkenstrain's graves: no capture of a full bag, so the retry is ours.
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
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };

let core;
let I;
let N;
let O;
let next = 9700;

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

const quest = (key) => {
  const found = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
  assert.ok(found, `quest ${key} is registered`);
  return found;
};
const stageOf = (f, key) => quest(key).getStage(f.p);
const put = (f, id, slot, amount = 1) => f.inv.setItem(slot, new core.Item(id, amount));

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), 0);
}

function drop(f, id) {
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === id), new core.Item(-1, 0));
  f.inv.refreshItems();
}

function freeSlot(f) {
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === I.RAKE), new core.Item(-1, 0));
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

/** Plays what's open, answering menus from `answers`; stops at a menu it has no answer for. */
async function playChat(f, answers = []) {
  const queue = [...answers];
  const shown = [];
  for (let i = 0; i < 120; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const choice = menu.options.findIndex((option) => queue[0] !== undefined && option.startsWith(queue[0]));
      if (choice < 0) {
        shown.push(`MENU ${JSON.stringify(menu.options)}`);
        return shown;
      }
      queue.shift();
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    const manager = f.p.getDialogueManager();
    if (!manager.isActive()) {
      ticks(f, 2);
      if (!manager.isActive() && !core.MultiChatboxPrompt.getPending(f.p)) break;
      continue;
    }
    const current = manager.getCurrent();
    if (typeof current?.getText === "function") shown.push(String(current.getText()).replace(/<br>/g, " "));
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (!(current instanceof ActionDialogue) && group in CONTINUE_CHILD) {
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
    }
    ticks(f, 1);
  }
  return shown;
}

async function talk(t, f, npcId, answers) {
  const npc = core.NPC.create(npcId, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const actions = npc.getCurrentDefinition(f.p).getActions();
  const index = actions.findIndex((action) => action === "Talk-to");
  assert.ok(index >= 0, `control: ${npcId} has Talk-to: ${JSON.stringify(actions)}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  ticks(f, 3);
  const shown = await playChat(f, answers);
  f.p.getDialogueManager().reset();
  core.MultiChatboxPrompt.cancel?.(f.p);
  return shown;
}

async function clickLoc(t, f, id, answers, walkTicks = 3) {
  const at = new core.Location(HOME[0] + 1, HOME[1], 0);
  const loc = new core.GameObject(id, at, 10, 0);
  MapObjects.add(loc);
  t.after(() => MapObjects.remove(loc));
  await send(f, { type: "object_option", id, x: at.getX(), y: at.getY(), clickType: 1 });
  ticks(f, walkTicks);
  const shown = await playChat(f, answers);
  f.p.getDialogueManager().reset();
  return shown;
}

/** The chest's cache access mask refuses some sides ("You can't reach that!"), so this tries each. */
async function clickFromAnySide(t, f, id) {
  const sides = [[0, 0], [2, 0], [1, 1], [1, -1]];
  for (const [dx, dy] of sides) {
    f.p.setLocation(new core.Location(HOME[0] + dx, HOME[1] + dy, 0));
    f.messages.length = 0;
    await clickLoc(t, f, id, [], 12);
    if (!f.messages.includes("You can't reach that!")) return;
  }
}

// ------------------------------------------------------------------ Desert Treasure II

const DT2 = "desert_treasure_ii";
const CHAPTERS_STAGE = 7;
const LASSAR = "desert-treasure-ii:lassar";
const FOUND = "You find a medallion amongst the entrails.";
const NO_MUSHROOM_ROOM = "You don't have enough inventory space for any more mushrooms.";

/** By the hook, not a packet: this loc is a multiloc on dt2_lassar, whose Search needs the var's value. */
function searchRemains(f) {
  const at = new core.Location(HOME[0] + 1, HOME[1], 0);
  PM.emitObjectInteraction({
    player: f.p, object: new core.GameObject(47579, at, 10, 0), objectId: 47579, clickType: 1, option: "Search",
    location: { x: at.getX(), y: at.getY(), z: 0 }, handled: false,
  });
}

function afterWhisperer(t) {
  const f = actor(t, DT2, CHAPTERS_STAGE);
  f.p.setAttribute(LASSAR, { whispererDefeated: true });
  return f;
}

test("DT2: the Whisperer's remains refuse a full bag and flag nothing; with room they give it", (t) => {
  const control = afterWhisperer(t);
  searchRemains(control);
  assert.equal(control.inv.getAmount(I.WHISPERERS_MEDALLION), 1, "control: the medallion");
  assert.equal(control.p.getAttribute(LASSAR).medallion, true, "control: and the flag");
  assert.ok(control.messages.includes(FOUND), JSON.stringify(control.messages));

  const f = afterWhisperer(t);
  fill(f);
  searchRemains(f);
  assert.equal(f.p.getAttribute(LASSAR).medallion, undefined, "no flag without the medallion");
  assert.equal(f.messages.includes(FOUND), false, "and it isn't said to");
  assert.ok(f.messages.some((text) => /inventory space/.test(text)), JSON.stringify(f.messages));
  freeSlot(f);
  searchRemains(f);
  assert.equal(f.inv.getAmount(I.WHISPERERS_MEDALLION), 1, "with room they give it");
});

test("DT2: a dropped medallion comes back from the remains, as the Wiki has it", (t) => {
  const f = afterWhisperer(t);
  searchRemains(f);
  drop(f, I.WHISPERERS_MEDALLION);
  searchRemains(f);
  assert.equal(f.inv.getAmount(I.WHISPERERS_MEDALLION), 1, "it comes back");
  searchRemains(f);
  assert.equal(f.inv.getAmount(I.WHISPERERS_MEDALLION), 1, "control: no second one");
});

test("DT2: the last medallion's trial isn't undone at the remains", (t) => {
  // Rsprox 1703 t16397: 'You find your items in the chest, but the medallion is missing.' It is taken
  // from the player as the story, and comes back by its own drop.
  const f = afterWhisperer(t);
  f.p.setAttribute("desert-treasure-ii:medallions-placed", 0b1101);
  f.p.setAttribute("desert-treasure-ii:medallions-found", 0b0010);
  searchRemains(f);
  assert.equal(f.inv.getAmount(I.WHISPERERS_MEDALLION), 0, "no second medallion during the trial");

  const placed = afterWhisperer(t);
  placed.p.setAttribute("desert-treasure-ii:medallions-placed", 0b0010);
  searchRemains(placed);
  assert.equal(placed.inv.getAmount(I.WHISPERERS_MEDALLION), 0, "control: none once it is on its statue");
});

function enterAsylum(t, f) {
  f.p.setAttribute("desert-treasure-ii:sucellus-prison-complete", true);
  PM.emitObjectInteraction({
    player: f.p, object: new core.GameObject(49138, new core.Location(3039, 6433, 0), 10, 0), objectId: 49138, clickType: 1,
    location: { x: 3039, y: 6433, z: 0 }, handled: false,
  });
  const area = f.p.getAttribute("desert-treasure-ii:sucellus-area");
  assert.ok(area, "control: in the instance");
  return area;
}

/** Beside the player in the instance, by the hook: the loc's real tile there isn't what is under test. */
function clickInAsylum(f, id, option, offset = [1, 0]) {
  const at = f.p.getLocation();
  const [x, y, z] = [at.getX() + offset[0], at.getY() + offset[1], at.getZ()];
  PM.emitObjectInteraction({
    player: f.p, object: new core.GameObject(id, new core.Location(x, y, z), 10, 0, f.p.getPrivateArea?.()),
    objectId: id, clickType: 1, option, location: { x, y, z }, handled: false,
  });
  return { x, y };
}

/** The instance's own loc by the hook: this fixture's packet click doesn't land there (see the probe). */
function pick(f, area, id) {
  const loc = area.getObjects().find((object) => object.getId() === id);
  assert.ok(loc, `control: the instance has ${id}`);
  const at = loc.getLocation();
  PM.emitObjectInteraction({
    player: f.p, object: loc, objectId: id, clickType: 1, option: "Pick",
    location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
  });
}

/** Logs what a real click does here, without asserting on it, so the difference can be read from a run. */
async function probeClick(t, f, area, id, item) {
  const loc = area.getObjects().find((object) => object.getId() === id);
  const at = loc.getLocation();
  const from = f.p.getLocation();
  const before = f.messages.length;
  await send(f, { type: "object_option", id, x: at.getX(), y: at.getY(), clickType: 1 });
  ticks(f, 12);
  const to = f.p.getLocation();
  t.diagnostic(`probe loc ${at.getX()},${at.getY()},${at.getZ()} player ${from.getX()},${from.getY()},${from.getZ()} to ${to.getX()},${to.getY()} `
    + `area same ${f.p.getPrivateArea?.() === area} busy ${f.p.busy?.()} held ${f.inv.getAmount(item)} messages ${JSON.stringify(f.messages.slice(before))}`);
}

for (const [name, loc, item] of [["Musca", "MUSCA_MUSHROOMS", "MUSCA_MUSHROOM"], ["Arder", "ARDER_MUSHROOMS", "ARDER_MUSHROOM"]]) {
  test(`DT2: ${name} mushrooms have no cap, and a full bag is refused, as 91 and 1703 have it`, async (t) => {
    const f = actor(t, DT2, CHAPTERS_STAGE);
    const area = enterAsylum(t, f);
    await probeClick(t, f, area, O[loc], I[item]);
    const start = f.inv.getAmount(I[item]);
    for (let i = 0; i < 5; i++) pick(f, area, O[loc]);
    assert.equal(f.inv.getAmount(I[item]), start + 5, "five picks, five mushrooms");
    assert.ok(f.messages.includes("You pick a mushroom."), JSON.stringify(f.messages.slice(-2)));

    fill(f);
    const before = f.inv.getAmount(I[item]);
    pick(f, area, O[loc]);
    assert.equal(f.inv.getAmount(I[item]), before, "control: no room");
    assert.ok(f.messages.includes(NO_MUSHROOM_ROOM), JSON.stringify(f.messages.slice(-2)));
    freeSlot(f);
    pick(f, area, O[loc]);
    assert.equal(f.inv.getAmount(I[item]), before + 1, "picking resumes with room");
  });
}

test("DT2: an emptied vat refuses a full bag and stays ready", (t) => {
  const f = actor(t, DT2, CHAPTERS_STAGE);
  const area = enterAsylum(t, f);
  const VAT = 47536;
  const at = f.p.getLocation();
  const key = `${VAT}:${at.getX() + 1 - area.getBaseX() + 2872}:${at.getY() - area.getBaseY() + 6336}`;
  f.p.setAttribute("desert-treasure-ii:sucellus-vats", { [key]: { powders: [I.ARDER_POWDER, I.MUSCA_POWDER], salt: 6 } });
  fill(f);
  clickInAsylum(f, VAT, "Empty");
  assert.equal(f.p.getAttribute("desert-treasure-ii:sucellus-vats")[key].salt, 6, "the vat stays ready");
  assert.ok(f.messages.some((text) => /inventory space/.test(text)), JSON.stringify(f.messages.slice(-2)));
  freeSlot(f);
  clickInAsylum(f, VAT, "Empty");
  assert.equal(f.inv.getAmount(I.ARDER_MUSCA_POISON), 1, "with room it gives the poison");
  assert.equal(f.p.getAttribute("desert-treasure-ii:sucellus-vats")[key].salt, 0, "control: and empties");
});

// ------------------------------------------------------------------ Creature of Fenkenstrain

const FENK = "creature_of_fenkenstrain";

function atGrave(t, tile) {
  const f = actor(t, FENK, 1);
  f.p.setLocation(new core.Location(tile[0], tile[1], 0));
  put(f, I.SPADE, 0);
  return f;
}

async function dig(f) {
  f.messages.length = 0;
  await send(f, { type: "inventory_action", slot: 0, itemId: I.SPADE, widgetId: 3214, option: "Dig" });
  ticks(f, 2);
}

const TORSO_GRAVE = [3502, 3576];
const EMPTY = "...but the grave is empty.";

test("Fenkenstrain: a grave refuses a full bag and gives the part once there is room", async (t) => {
  const f = atGrave(t, TORSO_GRAVE);
  fill(f);
  await dig(f);
  assert.equal(f.messages.some((text) => /unearth a torso/.test(text)), false, "a full bag doesn't unearth it");
  assert.ok(f.messages.some((text) => /inventory space/.test(text)), JSON.stringify(f.messages));
  freeSlot(f);
  await dig(f);
  assert.equal(f.inv.getAmount(I.TORSO), 1, "with room it gives it");
});

test("Fenkenstrain: a dropped part comes back; one held or handed in doesn't", async (t) => {
  const f = atGrave(t, TORSO_GRAVE);
  await dig(f);
  assert.equal(f.inv.getAmount(I.TORSO), 1, "control: the torso");
  await dig(f);
  assert.equal(f.inv.getAmount(I.TORSO), 1, "control: no second torso");
  assert.ok(f.messages.includes(EMPTY), JSON.stringify(f.messages));
  drop(f, I.TORSO);
  await dig(f);
  assert.equal(f.inv.getAmount(I.TORSO), 1, "a dropped part comes back");

  const given = atGrave(t, TORSO_GRAVE);
  given.p.setAttribute("quest.creature_of_fenkenstrain.parts_given", 2);
  await dig(given);
  assert.equal(given.inv.getAmount(I.TORSO), 0, "handed in: none");
  assert.ok(given.messages.includes(EMPTY), JSON.stringify(given.messages));

  const head = atGrave(t, [3608, 3491]);
  put(head, I.DECAPITATED_HEAD_2, 1);
  await dig(head);
  assert.equal(head.inv.getAmount(I.DECAPITATED_HEAD), 0, "the head with its brain counts as the head");
  assert.ok(head.messages.includes(EMPTY), JSON.stringify(head.messages));
});
