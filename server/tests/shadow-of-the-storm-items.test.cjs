// Run after `yarn build`: node --test tests/shadow-of-the-storm-items.test.cjs
//
// #2577's bounded item bullets, through real dispatch:
// - Black dye: the recipes in the Wiki's Black mushroom ink products table, 2.5 Crafting XP each.
//   The Black cape page lists a Vial output; the Wizard hat, Black robe and Black desert pages don't.
// - Demonic tome: Read opens the native book, as rsprox 3333 (rev 235), tick 1975-1976, lines
//   20301-20393: "The Confession of Ellemar", with that spread's lines, and the player plays sequence
//   1350 on that tick. Later pages have no capture.
// - Evil Dave: the transcript's real conversation, "You've got to get back to the throne room!".
//   Rsprox 3333 ticks 2168 (lines 22591-22625) and 2184-2192: on a full inventory he says "But you'll
//   need to free some inventory space first!", after his "You'd better take this then...". The Dave
//   there is 913 at (2723,4897,0), as captured; 902 away from Uzer is Recipe for Disaster's.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const DAVE_TILE = [2723, 4897, 0];
const BESIDE_DAVE = [2722, 4897, 0];
const BOOK = 392;
const STAGE_RITUAL_DONE = 90;
const STAGE_TANYA_KILLED = 100;
const uid = (group, child) => (group << 16) | child;

let core;
let I;
let next = 7600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  core.RegionManager.loadMapFiles(DAVE_TILE[0], DAVE_TILE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage, at = [HOME[0], HOME[1], 0]) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("stormqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], at[2]));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const strings = new Map();
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, id) => { strings.set(id, text); return sendString(text, id); });
  const sequences = [];
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { sequences.push(animation.getId()); return perform(animation); });
  const xp = [];
  const skills = p.getSkillManager();
  const addExperiences = skills.addExperiences.bind(skills);
  t.mock.method(skills, "addExperiences", (skill, amount) => { xp.push([skill, amount]); return addExperiences(skill, amount); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  if (stage !== undefined) quest().setStage(p, stage);
  return { p, c, inv: p.getInventory(), strings, sequences, xp };
}

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.name === "Shadow of the Storm");

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const put = (f, id, slot) => f.inv.setItem(slot, new core.Item(id, 1));

async function useOn(f, slot, targetSlot) {
  await send(f, {
    type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
    target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
  });
}

// ------------------------------------------------------------------ black dye

test("black dye: each Wiki recipe gives its product, either way round, for one dye", async (t) => {
  const recipes = [
    ["GREEN_CAPE", "BLACK_CAPE"], ["RED_CAPE", "BLACK_CAPE"], ["BLUE_CAPE", "BLACK_CAPE"], ["ORANGE_CAPE", "BLACK_CAPE"],
    ["PINK_CAPE", "BLACK_CAPE"], ["PURPLE_CAPE", "BLACK_CAPE"], ["YELLOW_CAPE", "BLACK_CAPE"],
    ["BLUE_WIZARD_ROBE", "BLACK_ROBE"], ["BLUE_WIZARD_HAT", "WIZARD_HAT"],
    ["DESERT_SHIRT", "BLACK_DESERT_SHIRT"], ["DESERT_ROBE", "BLACK_DESERT_ROBE"],
  ];
  for (const [from, to] of recipes) {
    for (const [dyeSlot, clothSlot] of [[0, 1], [1, 0]]) {
      const f = actor(t);
      put(f, I.BLACK_DYE, dyeSlot);
      put(f, I[from], clothSlot);
      await useOn(f, 0, 1);
      assert.equal(f.inv.getAmount(I[to]), 1, `${from} gives ${to}`);
      assert.equal(f.inv.getAmount(I[from]), 0, `${from} is used`);
      assert.equal(f.inv.getAmount(I.BLACK_DYE), 0, `the dye is used on ${from}`);
      assert.deepEqual(f.xp, [[core.Skill.CRAFTING, 2.5]], `${from} gives 2.5 Crafting XP`);
      assert.equal(f.inv.getAmount(I.VIAL), to === "BLACK_CAPE" ? 1 : 0, `${from}: a vial back only as the Black cape page lists`);
    }
  }
});

test("control: the dye refuses what the Wiki does not list, and keeps both", async (t) => {
  const f = actor(t);
  put(f, I.BLACK_DYE, 0);
  put(f, I.BLACK_CAPE, 1);
  await useOn(f, 0, 1);
  assert.deepEqual([f.inv.getAmount(I.BLACK_DYE), f.inv.getAmount(I.BLACK_CAPE)], [1, 1]);
  assert.deepEqual(f.xp, [], "no XP");
  assert.equal(f.inv.getAmount(I.VIAL), 0, "no vial");
});

// ------------------------------------------------------------------ demonic tome

test("the demonic tome reads as the native book, with the captured first spread", async (t) => {
  const f = actor(t, 70);
  put(f, I.DEMONIC_TOME, 0);
  await send(f, { type: "inventory_action", slot: 0, itemId: I.DEMONIC_TOME, widgetId: 3214, option: "Read" });
  assert.equal(f.p.getInterfaceId(), BOOK, "the book is open");
  assert.deepEqual(f.sequences, [1350], "the player reads it");
  const line = (child) => f.strings.get(uid(BOOK, child));
  assert.equal(line(6), "The Confession of Ellemar");
  assert.deepEqual([line(9), line(10)], ["1", "2"]);
  assert.equal(line(44), "I know that it is too late to");
  assert.equal(line(55), "acted in his spirit.");
  assert.equal(line(60), "have fallen prey to demons,");
  assert.equal(line(74), "might we not find new and");

  const seen = [];
  for (let spread = 0; spread < 4; spread++) {
    for (const base of [44, 60]) for (let i = 0; i < 15; i++) seen.push(line(base + i));
    await send(f, { type: "dialogue_continue", widgetId: uid(BOOK, 77), childIndex: -1 });
  }
  const text = seen.filter(Boolean).join(" ");
  assert.match(text, /Camerinthum Agrith-Naar Tarren Caldar Nahudu/, "the tome has the incantation, the reverse of Denath's");
  assert.match(text, /The last pages of the book have been torn out/, "and ends where the Wiki does");
  assert.equal(f.inv.getAmount(I.DEMONIC_TOME), 1, "reading keeps it");
});

// ------------------------------------------------------------------ Evil Dave

async function talkDave(t, f) {
  const npc = core.NPC.create(913, new core.Location(...DAVE_TILE));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  ticks(f, 3);
  const lines = [];
  for (let i = 0; i < 40; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const choice = menu.options.findIndex((option) => option.startsWith("You've got to get back"));
      assert.ok(choice >= 0, `the throne room option: ${JSON.stringify(menu.options)}`);
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    const current = f.p.getDialogueManager().getCurrent();
    if (!current) { ticks(f, 1); if (!f.p.getDialogueManager().getCurrent()) break; continue; }
    const raw = current.getText?.();
    lines.push((Array.isArray(raw) ? raw.join(" ") : String(raw ?? "")).replace(/<br>/g, " "));
    const group = f.p.getPacketSender().getChatboxGroupId();
    await send(f, { type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 });
    ticks(f, 1);
  }
  return lines;
}

test("Evil Dave hands over Eric's sigil at the throne room answer", async (t) => {
  for (const stage of [STAGE_RITUAL_DONE, STAGE_TANYA_KILLED]) {
    const f = actor(t, stage, BESIDE_DAVE);
    const lines = await talkDave(t, f);
    t.diagnostic(`stage ${stage} lines ${JSON.stringify(lines)}`);
    assert.ok(lines.some((line) => /It was Eric's sigil/.test(line)), "he offers it");
    assert.equal(f.inv.getAmount(I.DEMONIC_SIGIL), 1, `stage ${stage}: the sigil arrives`);
  }
});

test("Evil Dave on a full inventory says to free a space, and hands it over after", async (t) => {
  const f = actor(t, STAGE_TANYA_KILLED, BESIDE_DAVE);
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  const lines = await talkDave(t, f);
  assert.ok(lines.some((line) => /you'll need to free some inventory space first/.test(line)), JSON.stringify(lines));
  assert.equal(f.inv.getAmount(I.DEMONIC_SIGIL), 0, "no sigil yet");

  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === I.RAKE), new core.Item(-1, 0));
  f.inv.refreshItems();
  await talkDave(t, f);
  assert.equal(f.inv.getAmount(I.DEMONIC_SIGIL), 1, "with room he hands it over");
});
