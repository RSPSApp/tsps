// Run after `yarn build`: node --test tests/tai-trio-jogre-bones.test.cjs
//
// Tai Bwo Wannai Trio's jogre bones (Wiki: Jogre bones, Burnt jogre bones, Superheat Item). A tinderbox
// needs Firemaking 30 ("You need a firemaking level of 30 to burn Jogre bones. You could find some other
// way of burning them."); a furnace needs no Firemaking and gives 25 Cooking XP; Superheat Item works in
// place of a furnace with Cooking 30, for 53 Magic and 25 Cooking XP. Real plugins and real Players,
// events sent through PluginManager.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const NEED_FM = "You need a firemaking level of 30 to burn Jogre bones. You could find some other way of burning them.";
let core, I, next = 6100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { firemaking = 1, cooking = 1, magic = 1 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("jogre" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2795, 3065, 0));
  player.needsPlacement = false;
  const skills = player.getSkillManager();
  for (const [skill, level] of [[core.Skill.FIREMAKING, firemaking], [core.Skill.COOKING, cooking], [core.Skill.MAGIC, magic]]) {
    skills.setMaxLevel(skill, level, false);
    skills.setCurrentLevel(skill, level, false);
  }
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => { messages.push(message); return player.getPacketSender(); });
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, messages };
}

const count = (player, id) => player.getInventory().getAmount(id);
const xp = (player, skill) => player.getSkillManager().getExperience(skill);
const slotOf = (player, id) => player.getInventory().getItems().findIndex((item) => item?.getId() === id);

function onObject(player, objectId) {
  return PM.emitItemOnObject({
    player, objectId, itemId: I.JOGRE_BONES, slot: slotOf(player, I.JOGRE_BONES), location: new core.Location(2795, 3066, 0), handled: false,
    object: { getDefinition: () => core.ObjectDefinition.forId(objectId), getId: () => objectId },
  });
}

test("a furnace burns the bones without Firemaking 30, for Cooking XP", (t) => {
  const { player, messages } = actor(t);
  player.getInventory().add(new core.Item(I.JOGRE_BONES, 1), false);
  const cooking = xp(player, core.Skill.COOKING), firemaking = xp(player, core.Skill.FIREMAKING);
  onObject(player, core.ObjectIdentifiers.FURNACE);
  assert.equal(count(player, I.JOGRE_BONES), 0);
  assert.equal(count(player, I.BURNT_JOGRE_BONES), 1, messages.join(" | "));
  assert.ok(!messages.includes(NEED_FM));
  assert.equal(xp(player, core.Skill.COOKING) - cooking, 25);
  assert.equal(xp(player, core.Skill.FIREMAKING), firemaking, "no Firemaking XP at a furnace");
});

test("a tinderbox below Firemaking 30 is refused with the Wiki's message", (t) => {
  const { player, messages } = actor(t);
  player.getInventory().add(new core.Item(I.TINDERBOX, 1), false);
  player.getInventory().add(new core.Item(I.JOGRE_BONES, 1), false);
  const used = player.getInventory().getItems()[slotOf(player, I.TINDERBOX)];
  const target = player.getInventory().getItems()[slotOf(player, I.JOGRE_BONES)];
  PM.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: slotOf(player, I.TINDERBOX),
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: slotOf(player, I.JOGRE_BONES), handled: false,
  });
  assert.ok(messages.includes(NEED_FM), messages.join(" | "));
  assert.equal(count(player, I.JOGRE_BONES), 1);
  assert.equal(count(player, I.BURNT_JOGRE_BONES), 0);
});

function superheat(t, cooking, boostedTo = cooking) {
  const f = actor(t, { cooking, magic: 43 });
  f.player.getSkillManager().setCurrentLevel(core.Skill.COOKING, boostedTo, false);
  f.player.getInventory().add(new core.Item(I.FIRE_RUNE, 4), false);
  f.player.getInventory().add(new core.Item(I.NATURE_RUNE, 1), false);
  f.player.getInventory().add(new core.Item(I.JOGRE_BONES, 1), false);
  f.slot = slotOf(f.player, I.JOGRE_BONES);
  f.magic = xp(f.player, core.Skill.MAGIC);
  f.cooking = xp(f.player, core.Skill.COOKING);
  PM.emitSpellOnItem({ player: f.player, spellName: "Superheat Item", itemId: I.JOGRE_BONES, slot: f.slot, handled: false });
  return f;
}

test("Superheat Item burns the bones in their slot with Cooking 30, for Magic and Cooking XP", (t) => {
  const { player, messages, slot, magic, cooking } = superheat(t, 30);
  assert.equal(player.getInventory().getItems()[slot]?.getId(), I.BURNT_JOGRE_BONES, messages.join(" | "));
  assert.equal(count(player, I.JOGRE_BONES), 0);
  assert.equal(count(player, I.FIRE_RUNE) + count(player, I.NATURE_RUNE), 0, "the spell's runes are used");
  assert.equal(xp(player, core.Skill.MAGIC) - magic, 53);
  assert.equal(xp(player, core.Skill.COOKING) - cooking, 25);
  assert.ok(!messages.includes("You need to cast superheat item on ore."));
});

test("Superheat Item below Cooking 30 keeps the bones and the runes", (t) => {
  const { player, messages } = superheat(t, 29);
  assert.equal(count(player, I.JOGRE_BONES), 1, messages.join(" | "));
  assert.equal(count(player, I.FIRE_RUNE), 4);
  assert.equal(count(player, I.NATURE_RUNE), 1);
  assert.ok(messages.some((message) => /Cooking level of at least 30/.test(message)), messages.join(" | "));
});

test("Superheat Item is refused at base Cooking 20 boosted to 30: the level is not boostable", (t) => {
  const { player, messages } = superheat(t, 20, 30);
  assert.equal(count(player, I.JOGRE_BONES), 1, messages.join(" | "));
  assert.equal(count(player, I.BURNT_JOGRE_BONES), 0);
  assert.equal(count(player, I.NATURE_RUNE), 1, "no runes are used");
  assert.ok(messages.some((message) => /Cooking level of at least 30/.test(message)), messages.join(" | "));
});
