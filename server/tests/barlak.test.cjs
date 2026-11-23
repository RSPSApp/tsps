// Run after `yarn build`: node --test tests/barlak.test.cjs
//
// Barlak (Dorgesh-Kaan) buys long and curved bones and giant shells. Wiki: long bone 1,000 coins
// + 4,500 Construction XP, curved bone 2,000 + 6,750 (house and unboosted 30 Construction for the
// XP), banked bones taken too; shells 600 coins each from the inventory, perfect ones +500 Crafting
// XP. rsprox captures: rec 2964 (rev 230) t350-395, nine long bones for 9000gp and 40,500 XP paid
// with "Thanks! Now, let me explain...", the lecture box, then his shell questions; two tortoise
// shells for 1200gp. Rec 4263 (rev 239) t1111-1118: one tortoise shell, 600gp.
// Real engine: every plugin loaded, a real Player, the real transcript runner.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { StatementDialogue } = require("../dist/game/model/dialogues/entries/impl/StatementDialogue");

let core;
let ids;
let next = 5400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  ids = {
    barlak: core.CacheDefinitions.getNpcId("dorgesh_male_bone_seller"),
    coins: obj("coins"),
    longBone: obj("dorgesh_construction_bone"),
    curvedBone: obj("dorgesh_construction_bone_curved"),
    tortoise: obj("battle_tortoise_shell"),
    perfectShell: obj("dorgesh_tortoise_shell"),
    snail: obj("templetrek_snail_shell"),
    perfectSnail: obj("dorgesh_snail_shell"),
  };
});

function actor(t, { construction = 99, house = true } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("barlak" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2697, 5315, 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, construction, false);
  if (house) PluginManager.createApi("BarlakTestHouse").emitCustomEvent("construction:grant-house", { player, granted: false });
  t.mock.method(player.getPacketSender(), "sendClientScript", () => player.getPacketSender());
  return player;
}

const put = (player, slot, id, amount = 1) => player.getInventory().setItem(slot, new core.Item(id, amount));
const coins = (player) => player.getInventory().getAmount(ids.coins);
const xp = (player, skill) => player.getSkillManager().getExperience(core.Skill[skill]);

function talk(player) {
  const npc = core.NPC.create(ids.barlak, new core.Location(2698, 5315, 0));
  PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType: 1, handled: false,
  });
}

/** Lines and boxes shown until a menu (or the end), continuing past each. */
function spoken(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 60 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof OptionDialogue) break;
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) lines.push(current.getText().replace(/\s+/g, " ").trim());
    if (current instanceof StatementDialogue) lines.push(`[box] ${String(current.getText?.() ?? current.text ?? "").replace(/\s+/g, " ").trim()}`);
    manager.advance();
  }
  return lines;
}

/** The open menu's options: a dialogue chain's or a chatbox prompt's. */
function options(player) {
  const current = player.getDialogueManager().getCurrent();
  if (current instanceof OptionDialogue) return current.getOptions();
  return core.MultiChatboxPrompt.getPending(player)?.options ?? null;
}

function choose(player, number) {
  const current = player.getDialogueManager().getCurrent();
  if (current instanceof OptionDialogue) return current.execute(number);
  assert.ok(core.MultiChatboxPrompt.getPending(player), "a menu is open");
  core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

test("nine long bones: 9000gp, and coins and 4,500 XP each paid as \"Thanks! Now, let me explain...\" shows (rec 2964 t358-t377)", (t) => {
  const player = actor(t);
  put(player, 0, ids.coins, 100);
  for (let slot = 1; slot <= 9; slot++) put(player, slot, ids.longBone);
  const before = xp(player, "CONSTRUCTION");
  talk(player);
  assert.deepEqual(spoken(player), [
    "Those bones! Those are exactly the sort of thing I need! Will you sell them?",
    "I'll give you 9000gp for the bones you're carrying and for any you have in your bank.",
    "I'll try to teach you something about Construction as well, but it's highly technical so you won't understand if you don't already have level 30 Construction.",
  ]);
  assert.deepEqual(options(player), ["Okay.", "No. I'll keep the bones."]);
  choose(player, 1);
  assert.equal(player.getInventory().getAmount(ids.longBone), 9, "nothing changes on the choice");
  const lines = spoken(player);
  assert.deepEqual(lines, ["Okay.", "Thanks! Now, let me explain...", "[box] Barlak gives you a short lecture and you learn more about Construction."]);
  assert.equal(player.getInventory().getAmount(ids.longBone), 0);
  assert.equal(coins(player), 9100);
  assert.equal(xp(player, "CONSTRUCTION") - before, 40500);
});

test("banked bones are counted and sold with the carried ones; a curved bone is 2,000 coins and 6,750 XP", (t) => {
  const player = actor(t);
  put(player, 0, ids.curvedBone);
  player.getBank(0).add(new core.Item(ids.longBone, 3));
  player.getBank(1).add(new core.Item(ids.curvedBone, 1));
  const before = xp(player, "CONSTRUCTION");
  talk(player);
  assert.equal(spoken(player)[1], "I'll give you 7000gp for the bones you're carrying and for any you have in your bank.");
  choose(player, 1);
  spoken(player);
  assert.equal(player.getInventory().getAmount(ids.curvedBone), 0);
  assert.equal(player.getBank(0).getAmount(ids.longBone), 0);
  assert.equal(player.getBank(1).getAmount(ids.curvedBone), 0);
  assert.equal(coins(player), 7000);
  assert.equal(xp(player, "CONSTRUCTION") - before, 3 * 4500 + 2 * 6750);
});

test("only banked bones still start his bones offer", (t) => {
  const player = actor(t);
  player.getBank(0).add(new core.Item(ids.longBone, 1));
  talk(player);
  assert.equal(spoken(player)[0], "Those bones! Those are exactly the sort of thing I need! Will you sell them?");
});

test("No. I'll keep the bones.: nothing is sold (rec 2964 t367)", (t) => {
  const player = actor(t);
  put(player, 1, ids.longBone);
  talk(player);
  spoken(player);
  choose(player, 2);
  assert.deepEqual(spoken(player), ["No thanks."]);
  assert.equal(player.getInventory().getAmount(ids.longBone), 1);
  assert.equal(coins(player), 0);
});

for (const [name, setup] of [
  ["below 30 Construction", { construction: 29 }],
  ["without a house", { house: false }],
]) {
  test(`${name}: he buys the bones for coins but gives no Construction XP (Wiki)`, (t) => {
    const player = actor(t, setup);
    put(player, 1, ids.longBone);
    const before = xp(player, "CONSTRUCTION");
    talk(player);
    spoken(player);
    choose(player, 1);
    spoken(player);
    assert.equal(coins(player), 1000);
    assert.equal(xp(player, "CONSTRUCTION"), before);
  });
}

test("after the bones he asks about carried shells: two tortoise shells for 1200gp (rec 2964 t380-t395)", (t) => {
  const player = actor(t);
  put(player, 1, ids.longBone);
  put(player, 18, ids.tortoise);
  put(player, 19, ids.tortoise);
  talk(player);
  spoken(player);
  choose(player, 1);
  assert.deepEqual(spoken(player), [
    "Okay.", "Thanks! Now, let me explain...",
    "[box] Barlak gives you a short lecture and you learn more about Construction.",
    "That giant shell...what is it?", "It's a giant battle tortoise shell!",
    "Hmm... I think I might be able to make something out of them.",
    "I'll give you 1200gp for the tortoise shells you're carrying.",
  ]);
  choose(player, 1);
  assert.deepEqual(spoken(player), ["Okay.", "Thanks. If you find any more shells like these, please bring them to me!"]);
  assert.equal(player.getInventory().getAmount(ids.tortoise), 0);
  assert.equal(coins(player), 1000 + 1200);
});

test("one tortoise shell: 600gp (rec 4263 t1111-t1118); a noted shell is not his", (t) => {
  const player = actor(t);
  put(player, 18, ids.tortoise);
  const noted = core.ItemDefinition.forId(ids.tortoise).getNoteId?.() ?? -1;
  if (noted > 0) put(player, 20, noted, 5);
  talk(player);
  assert.deepEqual(spoken(player), [
    "That giant shell...what is it?", "It's a giant battle tortoise shell!",
    "Hmm... I think I might be able to make something out of them.",
    "I'll give you 600gp for the tortoise shells you're carrying.",
  ]);
  choose(player, 1);
  spoken(player);
  assert.equal(coins(player), 600);
  if (noted > 0) assert.equal(player.getInventory().getAmount(noted), 5);
});

test("a perfect shell: 600 coins and 500 Crafting XP, with the Crafting lecture (Wiki)", (t) => {
  const player = actor(t);
  put(player, 3, ids.perfectShell);
  const before = xp(player, "CRAFTING");
  talk(player);
  const lines = spoken(player);
  assert.equal(lines.at(-1), "I'll give you 600gp for the tortoise shell you're carrying, and I'll try to give you some advice on Crafting while I'm at it.");
  choose(player, 1);
  const after = spoken(player);
  assert.ok(after.includes("[box] Barlak gives you a short lecture and you learn more about Crafting."), after.join(" | "));
  assert.equal(player.getInventory().getAmount(ids.perfectShell), 0);
  assert.equal(coins(player), 600);
  assert.equal(xp(player, "CRAFTING") - before, 500);
});

test("snail shells: a plain and two perfect ones, 1800 coins and 1,000 Crafting XP", (t) => {
  const player = actor(t);
  put(player, 2, ids.snail);
  put(player, 3, ids.perfectSnail);
  put(player, 4, ids.perfectSnail);
  const before = xp(player, "CRAFTING");
  talk(player);
  const lines = spoken(player);
  assert.equal(lines[1], "It's a giant snail shell!");
  assert.equal(lines.at(-1), "I'll give you 1800gp for the snail shells you're carrying, and I'll try to give you some advice on Crafting while I'm at it.");
  choose(player, 1);
  spoken(player);
  assert.equal(player.getInventory().getAmount(ids.snail) + player.getInventory().getAmount(ids.perfectSnail), 0);
  assert.equal(coins(player), 1800);
  assert.equal(xp(player, "CRAFTING") - before, 1000);
});

test("the shells gone before his thanks: nothing is paid", (t) => {
  const player = actor(t);
  put(player, 18, ids.tortoise);
  talk(player);
  spoken(player);
  player.getInventory().delete(ids.tortoise, 1);
  choose(player, 1);
  spoken(player);
  assert.equal(coins(player), 0);
});

test("tortoise and snail shells: after the tortoise ones he asks about the other shell (Wiki transcript)", (t) => {
  const player = actor(t);
  put(player, 1, ids.tortoise);
  put(player, 2, ids.snail);
  talk(player);
  assert.equal(spoken(player)[1], "It's a giant battle tortoise shell!");
  choose(player, 1);
  const lines = spoken(player);
  assert.deepEqual(lines.slice(0, 4), ["Okay.", "Thanks. If you find any more shells like these, please bring them to me!",
    "That other giant shell...what is it?", "It's a giant snail shell!"]);
  assert.equal(lines.at(-1), "I'll give you 600gp for the snail shells you're carrying.");
  assert.equal(coins(player), 600);
  choose(player, 1);
  spoken(player);
  assert.equal(player.getInventory().getAmount(ids.snail), 0);
  assert.equal(coins(player), 1200);
});

test("nothing to sell: his usual conversation", (t) => {
  const player = actor(t);
  talk(player);
  assert.deepEqual(spoken(player).slice(0, 3), ["Bones!", "What?", "I don't have any bones!"]);
});
