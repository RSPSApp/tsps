// Run after `yarn build`: node --test tests/heroes-quest-gang-stages.test.cjs
// Heroes' Quest: the gang stages 2-4 and 7-11 were read by every variant selector but written by nothing, so the quest
// stayed at stage 1. Real engine, every plugin loaded, real conversations: each stage moves on the answer (or line) that
// earns it, and Straven / Katrine only for the player's own Shield of Arrav gang.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

const GANG = "shield-of-arrav.gang", PHOENIX = 1, BLACK_ARM = 2;
let core, next = 9420;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "heroes_quest");
const norm = (text) => String(text).toLowerCase().replace(/\s+/g, " ").trim();
const pendingOptions = (p) => {
  const shown = MultiChatboxPrompt.getPending(p);
  return shown ? shown.options : null;
};
const choose = (p, index) => MultiChatboxPrompt.handleInterfaceActionClick({
  player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, childId: 1, slot: index + 1, action: index + 1, handled: false,
});

function player(t, gang, stage) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("hero" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3000, 3000, 0)); p.needsPlacement = false;
  t.after(() => { p.closeInterruptibleInterfaces(); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  p.setAttribute(GANG, gang);
  quest().setStage(p, stage);
  return p;
}

/** Talk-to an NPC and read the conversation through: answer each menu with the first of `picks` that it offers (none: close it). */
function talk(p, npcName, picks = []) {
  const npcId = core.NpcIdentifiers[npcName];
  const npc = core.NPC.create(npcId, new core.Location(3000, 3001, 0));
  assert.equal(PM.emitNpcInteraction({ player: p, npc, npcId, action: "Talk-to", clickType: 1, handled: false }), true, `${npcName} opens a conversation`);
  const dm = p.getDialogueManager();
  const picked = [];
  for (let i = 0; i < 120; i++) {
    const options = pendingOptions(p);
    if (options) {
      const index = picks.map(norm).reduce((found, want) => (found >= 0 ? found : options.map(norm).findIndex((o) => o.includes(want))), -1);
      if (index < 0) break;
      picked.push(options[index]);
      choose(p, index);
      continue;
    }
    if (!dm.isActive()) break;
    const current = dm.getCurrent();
    if (typeof current?.getOptions === "function") {
      const shown = current.getOptions().map(norm);
      const index = picks.map(norm).reduce((found, want) => (found >= 0 ? found : shown.findIndex((o) => o.includes(want))), -1);
      if (index < 0) break;
      picked.push(shown[index]);
      dm.handleOption(index);
    } else dm.advance();
  }
  dm.reset(); p.closeInterruptibleInterfaces();
  return picked;
}

const stage = (p) => quest().getStage(p);
const wearBlackArmour = (p) => {
  p.getEquipment().set(Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.BLACK_FULL_HELM, 1));
  p.getEquipment().set(Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.BLACK_PLATEBODY, 1));
  p.getEquipment().set(Equipment.LEG_SLOT, new core.Item(core.ItemIdentifiers.BLACK_PLATELEGS, 1));
};
const papers = (p) => p.getInventory().getAmount(core.ItemIdentifiers.ID_PAPERS);

test("Straven starts the Phoenix route for a Phoenix member only", (t) => {
  const phoenix = player(t, PHOENIX, 1);
  talk(phoenix, "STRAVEN");
  assert.equal(stage(phoenix), 2);
  const blackArm = player(t, BLACK_ARM, 1);
  talk(blackArm, "STRAVEN");
  assert.equal(stage(blackArm), 1, "a Black Arm member who speaks to Straven first stays on stage 1");
});

test("Alfonse: only asking about gherkins moves 2 to 3", (t) => {
  const p = player(t, PHOENIX, 2);
  for (const pick of ["No thank you.", "Yes please.", "Where do you get your Karambwan from?"]) {
    talk(p, "ALFONSE_THE_WAITER", [pick]);
    assert.equal(stage(p), 2, pick);
  }
  assert.equal(talk(p, "ALFONSE_THE_WAITER", ["Do you sell Gherkins?"]).length, 1);
  assert.equal(stage(p), 3);
});

test("Charlie: only the candlesticks answer moves 3 to 4", (t) => {
  const p = player(t, PHOENIX, 3);
  talk(p, "CHARLIE_THE_COOK", ["Just exploring..."]);
  talk(p, "CHARLIE_THE_COOK", ["I'm looking for a gherkin...", "Sun, sand and the fresh sea air!"]);
  assert.equal(stage(p), 3);
  talk(p, "CHARLIE_THE_COOK", ["I'm looking for a gherkin...", "I want to steal Scarface Pete's candlesticks."]);
  assert.equal(stage(p), 4);
});

test("Katrine: only the master thief question moves 1 to 7, and only for a Black Arm member", (t) => {
  const p = player(t, BLACK_ARM, 1);
  talk(p, "KATRINE", ["Who are all those people in there?"]);
  assert.equal(stage(p), 1);
  talk(p, "KATRINE", ["Is there any way I can get the rank of master thief?"]);
  assert.equal(stage(p), 7);
  const phoenix = player(t, PHOENIX, 1);
  talk(phoenix, "KATRINE", ["Is there any way I can get the rank of master thief?"]);
  assert.equal(stage(phoenix), 1, "a Phoenix member is not put on the Black Arm route");
});

test("Grubor: only the right password moves 7 to 8", (t) => {
  const p = player(t, BLACK_ARM, 7);
  for (const pick of ["Rabbit's foot.", "Lucky horseshoe.", "Black cat."]) {
    talk(p, "GRUBOR", [pick]);
    assert.equal(stage(p), 7, pick);
  }
  talk(p, "GRUBOR", ["Four leaved clover."]);
  assert.equal(stage(p), 8);
});

test("Trobert: volunteering moves 8 to 9 and hands over the Id papers; declining does neither", (t) => {
  const p = player(t, BLACK_ARM, 8);
  talk(p, "TROBERT", ["Pleased to meet you."]);
  talk(p, "TROBERT", ["So can you help me get Scarface Pete's candlesticks?", "Well, good luck then."]);
  assert.equal(stage(p), 8);
  assert.equal(papers(p), 0);
  talk(p, "TROBERT", ["So can you help me get Scarface Pete's candlesticks?", "I volunteer to undertake that mission!"]);
  assert.equal(stage(p), 9);
  assert.equal(papers(p), 1);
  p.getInventory().deleteNumber(core.ItemIdentifiers.ID_PAPERS, 1);
  talk(p, "TROBERT", ["So can you help me get Scarface Pete's candlesticks?", "I volunteer to undertake that mission!"]);
  assert.equal(stage(p), 9);
  assert.equal(papers(p), 1, "a lost set comes from Trobert again");
});

test("Garv: black armour and the papers move 9 to 10", (t) => {
  const p = player(t, BLACK_ARM, 9);
  talk(p, "GARV");
  assert.equal(stage(p), 9, "no armour, no papers");
  wearBlackArmour(p);
  talk(p, "GARV");
  assert.equal(stage(p), 9, "armour but no papers");
  p.getInventory().add(new core.Item(core.ItemIdentifiers.ID_PAPERS, 1));
  talk(p, "GARV");
  assert.equal(stage(p), 10);
});

test("Grip: handing over the papers moves 10 to 11", (t) => {
  const p = player(t, BLACK_ARM, 10);
  talk(p, "GRIP");
  assert.equal(stage(p), 10, "no papers");
  p.getInventory().add(new core.Item(core.ItemIdentifiers.ID_PAPERS, 1));
  talk(p, "GRIP", ["So what do my duties involve?"]);
  assert.equal(stage(p), 11);
  assert.equal(papers(p), 0, "Grip keeps the papers");
});

test("opening a gang conversation and leaving it moves nothing; out-of-order talks change nothing", (t) => {
  for (const [name, gang, from] of [["ALFONSE_THE_WAITER", PHOENIX, 2], ["CHARLIE_THE_COOK", PHOENIX, 3], ["GRUBOR", BLACK_ARM, 7], ["TROBERT", BLACK_ARM, 8], ["GARV", BLACK_ARM, 9], ["GRIP", BLACK_ARM, 10]]) {
    const p = player(t, gang, from);
    talk(p, name);
    assert.equal(stage(p), from, name);
  }
  const early = player(t, PHOENIX, 4);
  talk(early, "STRAVEN");
  assert.equal(stage(early), 4);
  const garvEarly = player(t, BLACK_ARM, 8);
  talk(garvEarly, "GARV");
  assert.equal(stage(garvEarly), 8);
});

test("Trobert hands the papers out again at stage 10 if they were lost after Garv, and Grip then takes them", (t) => {
  const p = player(t, BLACK_ARM, 10);
  assert.equal(papers(p), 0);
  talk(p, "TROBERT", ["So can you help me get Scarface Pete's candlesticks?", "I volunteer to undertake that mission!"]);
  assert.equal(papers(p), 1);
  assert.equal(stage(p), 10);
  talk(p, "GRIP", ["So what do my duties involve?"]);
  assert.equal(stage(p), 11);
  assert.equal(papers(p), 0, "Grip keeps the papers");
  const late = player(t, BLACK_ARM, 11);
  talk(late, "TROBERT", ["So can you help me get Scarface Pete's candlesticks?", "I volunteer to undertake that mission!"]);
  assert.equal(papers(late), 0, "after Grip has them Trobert hands out nothing");
});

test("Trobert with a full bag hands over nothing and the stage stays put", (t) => {
  const volunteer = ["So can you help me get Scarface Pete's candlesticks?", "I volunteer to undertake that mission!"];
  const fill = (p) => { while (p.getInventory().getFreeSlots() > 0) p.getInventory().add(new core.Item(core.ItemIdentifiers.SWORDFISH, 1)); };
  const p = player(t, BLACK_ARM, 8);
  fill(p);
  talk(p, "TROBERT", volunteer);
  assert.equal(papers(p), 0);
  assert.equal(stage(p), 8, "no papers went in, so 8 stays 8");
  p.getInventory().deleteNumber(core.ItemIdentifiers.SWORDFISH, 1);
  talk(p, "TROBERT", volunteer);
  assert.equal(papers(p), 1);
  assert.equal(stage(p), 9);
  const q = player(t, BLACK_ARM, 10);
  fill(q);
  talk(q, "TROBERT", volunteer);
  assert.equal(papers(q), 0);
  assert.equal(stage(q), 10);
});
