// Run after `yarn build`: node --test tests/quest-reward-room.test.cjs
//
// Quest steps that lose an item, or the money for it, on a full inventory. No capture shows a full
// bag at any of these, so refusal wording is ours; the rest is the Wiki:
// - Grip's keyring: "Once he dies, pick up Grip's keyring", so it can lie on the ground.
// - Arkan blade: "any dropped blades are deleted upon repurchasing", so it is refused, not dropped.
// - Grish's supplies: Transcript:Zogre_Flesh_Eaters, "Goes to ground with full inventory".
// Real dispatch where there is one: death as NPCDeathTask sends it, item on loc and Talk-to by packet.
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
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const CHEST = 2632;
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const NO_ROOM = "You don't have enough inventory space.";
const STAGE_PHOENIX_CHARLIE = 4;
const STAGE_PHOENIX_GRIP = 5;
const STAGE_BLACK_GRIP = 11;
const STAGE_BLACK_CANDLESTICK = 12;
const FINAL_DAWN_DONE = 68;

let core;
let I;
let N;
let next = 9300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("roomqa" + p.getIndex());
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
  return { p, c, inv: p.getInventory(), messages };
}

const quest = (key) => {
  const found = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
  assert.ok(found, `quest ${key} is registered`);
  return found;
};

const put = (f, id, slot, amount = 1) => f.inv.setItem(slot, new core.Item(id, amount));

function fill(f, leave = 0) {
  while (f.inv.getFreeSlots() > leave) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), leave, "control: the bag is as full as asked");
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

const onGround = (f, id) => ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), null);

/** Plays the open conversation, answering each menu from `answers`, and returns what it showed. */
async function playChat(f, answers) {
  const queue = [...answers];
  const shown = [];
  for (let i = 0; i < 120; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const choice = menu.options.findIndex((option) => option.startsWith(queue[0] ?? "\0"));
      assert.ok(choice >= 0, `"${queue[0]}" is on the menu: ${JSON.stringify(menu.options)}`);
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
  assert.deepEqual(queue, [], "every expected menu came up");
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
  return playChat(f, answers);
}

// ------------------------------------------------------------------ Grip's keyring

function killGrip(f) {
  const npc = core.NPC.create(N.GRIP, new core.Location(HOME[0] + 1, HOME[1], 0));
  PM.emitNpcDeath({
    npc, killer: f.p, npcId: npc.getContentId(f.p), remains: null,
    location: { x: HOME[0] + 1, y: HOME[1], z: 0 },
  });
}

const heroes = () => quest("heroes_quest");

function atStage(t, stage) {
  const f = actor(t);
  heroes().setStage(f.p, stage);
  return f;
}

test("Grip's keyring: with room in the bag; on a full bag on the ground, as the stage moves", (t) => {
  const control = atStage(t, STAGE_PHOENIX_CHARLIE);
  killGrip(control);
  assert.equal(control.inv.getAmount(I.GRIPS_KEYRING), 1, "control: in the bag");
  assert.equal(onGround(control, I.GRIPS_KEYRING), null, "control: not on the ground");
  assert.equal(heroes().getStage(control.p), STAGE_PHOENIX_GRIP, "control: the stage moves");

  const f = atStage(t, STAGE_PHOENIX_CHARLIE);
  fill(f);
  killGrip(f);
  assert.equal(f.inv.getAmount(I.GRIPS_KEYRING), 0, "control: no room");
  assert.equal(heroes().getStage(f.p), STAGE_PHOENIX_GRIP, "the stage still moves");
  assert.ok(onGround(f, I.GRIPS_KEYRING), "the keyring lies on the ground");
});

test("Grip's keyring: a player who lost it kills him again, and one who didn't gets no second", (t) => {
  const lost = atStage(t, STAGE_PHOENIX_GRIP);
  killGrip(lost);
  assert.equal(lost.inv.getAmount(I.GRIPS_KEYRING), 1, "he gives it again");
  assert.equal(heroes().getStage(lost.p), STAGE_PHOENIX_GRIP, "the stage stays");

  const holding = atStage(t, STAGE_PHOENIX_GRIP);
  put(holding, I.GRIPS_KEYRING, 0);
  killGrip(holding);
  assert.equal(holding.inv.getAmount(I.GRIPS_KEYRING), 1, "control: no second keyring");

  const done = atStage(t, STAGE_PHOENIX_GRIP);
  put(done, I.PETES_CANDLESTICK, 0);
  killGrip(done);
  assert.equal(done.inv.getAmount(I.GRIPS_KEYRING), 0, "control: none once the candlestick is held");

  const early = atStage(t, 3);
  killGrip(early);
  assert.equal(early.inv.getAmount(I.GRIPS_KEYRING), 0, "control: none before the route reaches him");
});

// ------------------------------------------------------------------ Pete's candlestick

async function useKeyOnChest(t, f) {
  const at = new core.Location(HOME[0] + 1, HOME[1], 0);
  const chest = new core.GameObject(CHEST, at, 10, 0);
  MapObjects.add(chest);
  t.after(() => MapObjects.remove(chest));
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === I.GRIPS_KEYRING);
  await send(f, {
    type: "inventory_use_on", slot, itemId: I.GRIPS_KEYRING,
    target: { kind: "loc", id: CHEST, x: at.getX(), y: at.getY(), level: 0 },
  });
  ticks(f, 3);
}

function withKey(t, stage) {
  const f = atStage(t, stage);
  put(f, I.GRIPS_KEYRING, 0);
  return f;
}

test("the candlestick chest gives it with room, and refuses a full bag without moving the stage", async (t) => {
  const control = withKey(t, STAGE_BLACK_GRIP);
  await useKeyOnChest(t, control);
  assert.equal(control.inv.getAmount(I.PETES_CANDLESTICK), 1, "control: the candlestick");
  assert.equal(heroes().getStage(control.p), STAGE_BLACK_CANDLESTICK, "control: and the stage");

  for (const stage of [STAGE_BLACK_GRIP, STAGE_PHOENIX_GRIP]) {
    const f = withKey(t, stage);
    fill(f);
    await useKeyOnChest(t, f);
    assert.equal(heroes().getStage(f.p), stage, `stage ${stage} waits`);
    assert.ok(f.messages.includes(NO_ROOM), `stage ${stage} says why: ${JSON.stringify(f.messages)}`);
    assert.equal(f.messages.some((text) => text.startsWith("You unlock the chest")), false, "and unlocks nothing");
    freeSlot(f);
    await useKeyOnChest(t, f);
    assert.equal(f.inv.getAmount(I.PETES_CANDLESTICK), 1, `stage ${stage}: with room it gives it`);
  }
});

test("the chest gives it again after the stage moved, and no second one", async (t) => {
  const lost = withKey(t, STAGE_BLACK_CANDLESTICK);
  await useKeyOnChest(t, lost);
  assert.equal(lost.inv.getAmount(I.PETES_CANDLESTICK), 1, "a player who lost it gets another");
  assert.equal(heroes().getStage(lost.p), STAGE_BLACK_CANDLESTICK, "the stage stays");

  const holding = withKey(t, STAGE_BLACK_CANDLESTICK);
  put(holding, I.PETES_CANDLESTICK, 1);
  await useKeyOnChest(t, holding);
  assert.equal(holding.inv.getAmount(I.PETES_CANDLESTICK), 1, "control: no second candlestick");
});

// ------------------------------------------------------------------ Arkan blade

const BLADE_ANSWERS = ["You don't happen to have another sword", "Yes."];

function bladeBuyer(t, coins) {
  const f = actor(t);
  quest("the_final_dawn").setStage(f.p, FINAL_DAWN_DONE);
  put(f, I.COINS, 0, coins);
  return f;
}

test("Arkan blade: a full bag keeps its coins and the conversation stops", async (t) => {
  const control = bladeBuyer(t, 300000);
  await talk(t, control, N.PRINCE_ITZLA_ARKAN, BLADE_ANSWERS);
  assert.deepEqual([control.inv.getAmount(I.COINS), control.inv.getAmount(I.ARKAN_BLADE)], [50000, 1], "control: room");

  const exact = bladeBuyer(t, 250000);
  fill(exact);
  await talk(t, exact, N.PRINCE_ITZLA_ARKAN, BLADE_ANSWERS);
  assert.deepEqual([exact.inv.getAmount(I.COINS), exact.inv.getAmount(I.ARKAN_BLADE)], [0, 1], "control: exact coins free their slot");

  const f = bladeBuyer(t, 300000);
  fill(f);
  await talk(t, f, N.PRINCE_ITZLA_ARKAN, BLADE_ANSWERS);
  assert.deepEqual([f.inv.getAmount(I.COINS), f.inv.getAmount(I.ARKAN_BLADE)], [300000, 0], "nothing changes hands");
  assert.ok(f.messages.includes(NO_ROOM), JSON.stringify(f.messages));
  assert.equal(f.messages.some((text) => text.startsWith("You give Itzla")), false, "and it isn't said to");
  assert.equal(onGround(f, I.ARKAN_BLADE), null, "control: no blade on the ground, which the Wiki warns of");
  assert.equal(f.p.getDialogueManager().isActive(), false, "the conversation is over");
});

// ------------------------------------------------------------------ Grish's supplies

const GRISH_ANSWERS = [
  "What do you mean sickies?", "Can I help in any way?", "Ok, I'll check things out", "Yes, I'm really sure!",
];

const groundAmount = (f, id) => onGround(f, id)?.getItem().getAmount() ?? 0;

/** What Grish asks before the start: without these the conversation ends at "too green". */
function qualifiedForGrish(t) {
  const f = actor(t);
  const skills = f.p.getSkillManager();
  for (const [skill, level] of [[core.Skill.RANGED, 30], [core.Skill.FLETCHING, 30], [core.Skill.SMITHING, 4], [core.Skill.HERBLORE, 8]]) {
    skills.setCurrentLevel(skill, level, false);
  }
  f.p.setAttribute("quest.jungle_potion.stage", 12);
  f.p.setAttribute("quest.big_chompy_bird_hunting.stage", 65);
  return f;
}

test("Grish's supplies: in the bag with room, and what doesn't fit goes to the ground", async (t) => {
  const control = qualifiedForGrish(t);
  await talk(t, control, N.GRISH, GRISH_ANSWERS);
  assert.deepEqual([control.inv.getAmount(I.COOKED_CHOMPY), control.inv.getAmount(I.SUPER_RESTORE_3_)], [3, 2], "control: room");
  assert.equal(groundAmount(control, I.COOKED_CHOMPY), 0, "control: nothing on the ground");

  const full = qualifiedForGrish(t);
  fill(full);
  await talk(t, full, N.GRISH, GRISH_ANSWERS);
  assert.ok(quest("zogre_flesh_eaters").getStage(full.p) > 0, "control: the quest starts");
  assert.deepEqual([groundAmount(full, I.COOKED_CHOMPY), groundAmount(full, I.SUPER_RESTORE_3_)], [3, 2], "all on the ground");

  const partial = qualifiedForGrish(t);
  fill(partial, 1);
  await talk(t, partial, N.GRISH, GRISH_ANSWERS);
  assert.equal(partial.inv.getAmount(I.COOKED_CHOMPY), 1, "what fits goes in the bag");
  assert.deepEqual([groundAmount(partial, I.COOKED_CHOMPY), groundAmount(partial, I.SUPER_RESTORE_3_)], [2, 2], "the rest on the ground");
});
