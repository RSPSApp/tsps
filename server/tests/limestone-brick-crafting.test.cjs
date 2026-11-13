/**
 * A chisel on limestone (plugins/skills/crafting/Limestone.Crafting.js), against the rsprox
 * captures (recordings 261 and 690, rev 229) and the Wiki (Limestone brick: 12 Crafting, 6 XP).
 * Real Player, every plugin loaded, the real item-on-item hooks.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const WorldDefinition = require("../dist/game/definition/WorldDefinition");

const CARVE = "You use the chisel on the limestone and carve it into a building block.";

let core;
let I;
let next = 5300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { members = true, level = 99 } = {}) {
  const saved = WorldDefinition.isMembersWorld;
  WorldDefinition.isMembersWorld = () => members;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("limestone" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3493, 3289, 0));
  p.needsPlacement = false;
  if (level !== 99) {
    p.getSkillManager().setMaxLevel(core.Skill.CRAFTING, level).setCurrentLevel(core.Skill.CRAFTING, level);
  } else {
    p.getSkillManager().setMaxLevel(core.Skill.CRAFTING, 99).setCurrentLevel(core.Skill.CRAFTING, 99);
  }
  const log = { messages: [], spam: [], sounds: [], animations: [] };
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { log.messages.push(m); return sender; });
  t.mock.method(sender, "sendTypedMessage", (type, m) => { (type === core.ChatType.SPAM ? log.spam : log.messages).push(m); return sender; });
  const sendSound = core.Sounds.sendSound;
  t.mock.method(core.Sounds, "sendSound", (player, sound, ...rest) => { if (player === p) log.sounds.push(sound); return sendSound(player, sound, ...rest); });
  const performAnimation = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { log.animations.push(animation.getId()); return performAnimation(animation); });
  t.after(() => {
    WorldDefinition.isMembersWorld = saved;
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, log, inv: p.getInventory() };
}

function hold(f, ...ids) {
  ids.forEach((id, slot) => { if (id) f.inv.setItem(slot, new core.Item(id, 1)); });
}

const slotOf = (f, id) => f.inv.getItems().findIndex((held) => held?.getId() === id);

function useOn(f, usedSlot, targetSlot) {
  const used = f.inv.get(usedSlot), target = f.inv.get(targetSlot);
  const event = {
    player: f.p, usedItem: used, usedItemId: used.getId(), usedItemSlot: usedSlot,
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: targetSlot, handled: false,
  };
  PM.emitItemOnItem(event);
  return event;
}

const crafting = (f) => f.p.getSkillManager().getExperience(core.Skill.CRAFTING);

test("a chisel on limestone carves one brick in the first limestone's slot, as recordings 261 and 690 show", (t) => {
  const f = actor(t);
  hold(f, I.LIMESTONE, I.LIMESTONE, I.CHISEL);
  const xp = crafting(f);
  const event = useOn(f, 2, 1);
  assert.equal(event.handled, true);
  assert.equal(f.inv.get(0)?.getId(), I.LIMESTONE_BRICK, "recording 690 tick 300: used on a later limestone, the brick is in the first one's slot");
  assert.equal(f.inv.get(1)?.getId(), I.LIMESTONE, "the used limestone stays; one brick per use, no menu or repeat");
  assert.equal(f.inv.getAmount(I.CHISEL), 1, "the chisel stays");
  assert.equal(crafting(f) - xp, 6, "Wiki and recording 261: 6 Crafting XP");
  assert.deepEqual(f.log.animations, [core.CacheDefinitions.getSeqId("human_limestonecutting")]);
  assert.deepEqual(f.log.spam, [CARVE]);
  assert.deepEqual(f.log.messages, []);
  assert.deepEqual(f.log.sounds, [], "no sound in the captures");
});

test("limestone used on the chisel carves the same way", (t) => {
  const f = actor(t);
  hold(f, I.CHISEL, I.LIMESTONE);
  useOn(f, 1, 0);
  assert.equal(slotOf(f, I.LIMESTONE_BRICK), 1);
  assert.equal(f.inv.getAmount(I.LIMESTONE), 0);
  assert.deepEqual(f.log.spam, [CARVE]);
});

test("below level 12 nothing is carved", (t) => {
  const f = actor(t, { level: 11 });
  hold(f, I.LIMESTONE, I.CHISEL);
  const xp = crafting(f);
  const event = useOn(f, 1, 0);
  assert.equal(event.handled, true);
  assert.equal(f.inv.getAmount(I.LIMESTONE), 1);
  assert.equal(f.inv.getAmount(I.LIMESTONE_BRICK), 0);
  assert.equal(crafting(f), xp);
  assert.deepEqual(f.log.animations, []);
  assert.deepEqual(f.log.messages, ["You need a Crafting level of 12 to carve limestone."]);
});

test("level 12 is enough", (t) => {
  const f = actor(t, { level: 12 });
  hold(f, I.LIMESTONE, I.CHISEL);
  useOn(f, 1, 0);
  assert.equal(f.inv.getAmount(I.LIMESTONE_BRICK), 1);
});

test("a free-to-play world does not carve limestone", (t) => {
  const f = actor(t, { members: false });
  hold(f, I.LIMESTONE, I.CHISEL);
  useOn(f, 1, 0);
  assert.equal(f.inv.getAmount(I.LIMESTONE), 1);
  assert.equal(f.inv.getAmount(I.LIMESTONE_BRICK), 0);
});
