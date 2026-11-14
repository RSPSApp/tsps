// Run after `yarn build`: node --test tests/ratcatchers-ali-reclaim.test.cjs
//
// Ratcatchers stage 20: Ali's "I've lost some of the gear you gave me" re-ask handed the charm and music scroll out
// with a bare adds() (a full inventory got nothing) and judged "lost" from the inventory alone, so a banked charm or
// scroll was handed out again. Real plugins, a real Player, Inventory and Bank; the dialogue hooks go through
// PluginManager. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core;
let index = 7660;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const RECLAIM = "learning-to-charm-animals-reclaiming-the-snake-charm-if-lost";
const AGAIN = "learning-to-charm-animals-talking-to-the-snake-charmer-again";
const GIVE_LINE = "There you go. Now if you don't mind, I'm busy performing.";

function player(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername(name); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  QuestRuntime.questNamed("Ratcatchers").setStage(p, 20);
  return p;
}

const ali = () => core.NpcIdentifiers.ALI_THE_SNAKE_CHARMER;
const variant = (p) => PM.emitNpcDialogueVariant({ player: p, npcId: ali() });
const lost = (p, stepId) => PM.emitNpcDialogueCondition({ player: p, npcId: ali(), stepId, text: "", definition: { getName: () => "" } });
// The payload NpcDialogues.plugin.js sends for a transcript line.
const giveLine = (p) => PM.emitCustomEvent("npc-dialogue:line", { player: p, npc: null, npcId: ali(),
  definition: core.NpcDefinition.forId(ali()), step: { type: "line", speaker: "Ali the Snake Charmer", text: GIVE_LINE },
  text: GIVE_LINE, pages: [{ page: "Ratcatchers", variants: [RECLAIM] }], skip: false });

test("a banked charm and scroll are not lost: Ali offers no reclaim and hands out nothing", (t) => {
  const I = core.ItemIdentifiers;
  const p = player(t, "ratali1");
  p.getBank(0).add(new core.Item(I.SNAKE_CHARM, 1));
  p.getBank(0).add(new core.Item(I.MUSIC_SCROLL, 1));
  assert.equal(variant(p).variant ?? variant(p), AGAIN);
  assert.deepEqual(["SpbdeZ", "NqCxPD", "nqrJQU"].map((id) => lost(p, id)), [false, false, false]);
  giveLine(p);
  assert.equal(p.getInventory().getAmount(I.SNAKE_CHARM), 0);
  assert.equal(p.getInventory().getAmount(I.MUSIC_SCROLL), 0);

  // Only the scroll banked: the flute alone is lost and handed out; a placeholder is not a banked item.
  p.getBank(0).resetItems();
  p.getBank(0).add(new core.Item(I.MUSIC_SCROLL, 1));
  p.getBank(0).add(new core.Item(I.SNAKE_CHARM, 0));
  assert.equal(variant(p).variant ?? variant(p), RECLAIM);
  assert.deepEqual(["SpbdeZ", "NqCxPD", "nqrJQU"].map((id) => lost(p, id)), [true, false, false]);
  giveLine(p);
  assert.equal(p.getInventory().getAmount(I.SNAKE_CHARM), 1);
  assert.equal(p.getInventory().getAmount(I.MUSIC_SCROLL), 0);
});

test("a full inventory gets the reclaimed charm and scroll on the floor, not nowhere", (t) => {
  const I = core.ItemIdentifiers;
  const p = player(t, "ratali2");
  const inventory = p.getInventory();
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.LOGS, 1));
  const dropped = [];
  const original = ItemOnGroundManager.registers;
  ItemOnGroundManager.registers = (_player, item) => { dropped.push(item.getId()); };
  t.after(() => { ItemOnGroundManager.registers = original; });
  giveLine(p);
  assert.deepEqual(dropped, [I.SNAKE_CHARM, I.MUSIC_SCROLL]);
});

test("stage 19's purchase hands out only what is not already owned: a banked charm is not sold twice", (t) => {
  const I = core.ItemIdentifiers;
  const quest = QuestRuntime.questNamed("Ratcatchers");
  const p = player(t, "ratali3");
  quest.setStage(p, 19);
  const take = "Here, take these.";
  const buy = () => PM.emitCustomEvent("npc-dialogue:line", { player: p, npc: null, npcId: ali(),
    definition: core.NpcDefinition.forId(ali()), step: { type: "line", speaker: "Ali the Snake Charmer", text: take },
    text: take, pages: [{ page: "Ratcatchers" }], skip: false });
  // The Feud's snake charm sits in the bank (tab 1); a placeholder for the scroll holds 0.
  p.getBank(1).add(new core.Item(I.SNAKE_CHARM, 1));
  p.getBank(0).add(new core.Item(I.MUSIC_SCROLL, 0));
  const inventory = p.getInventory();
  for (let slot = 0; slot < 27; slot++) inventory.setItem(slot, new core.Item(I.LOGS, 1));
  inventory.adds(I.COINS, 150);
  buy();
  assert.equal(inventory.getAmount(I.SNAKE_CHARM), 0, "the banked charm is not handed out again");
  assert.equal(inventory.getAmount(I.MUSIC_SCROLL), 0, "no room yet: the coins slot stays");
  assert.equal(quest.getStage(p), 19);
  // Exact coins: their slot frees for the one item he hands over.
  inventory.deleteNumber(I.COINS, 50);
  buy();
  assert.equal(inventory.getAmount(I.COINS), 0);
  assert.equal(inventory.getAmount(I.MUSIC_SCROLL), 1);
  assert.equal(inventory.getAmount(I.SNAKE_CHARM), 0);
  assert.equal(quest.getStage(p), 20);
});
