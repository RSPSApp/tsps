/**
 * A gem on a silver sickle (b) (plugins/skills/crafting/GemSickles.Crafting.js), against the
 * rsprox captures (ruby: recordings 102 and 1637; diamond: recording 4288) and the Wiki XP.
 * Real Player, every plugin loaded, the real item-on-item hooks and the real chat menu.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const WorldDefinition = require("../dist/game/definition/WorldDefinition");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const OBJECTBOX_TEXT = (193 << 16) | 2;
const OBJECTBOX_ITEM = (193 << 16) | 1;
const GEM_CUTTING_SOUND = 2586;

let core;
let I;
let next = 5200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const saved = WorldDefinition.isMembersWorld;
  WorldDefinition.isMembersWorld = () => true;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gemsickle" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3597, 9614, 0));
  p.needsPlacement = false;
  const log = { messages: [], mesboxes: [], strings: new Map(), objects: [], sounds: [], animations: [] };
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { log.messages.push(m); return sender; });
  t.mock.method(sender, "sendTypedMessage", (type, m) => { if (type === core.ChatType.MESBOX) log.mesboxes.push(m); return sender; });
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, uid) => { log.strings.set(uid, text); return sendString(text, uid); });
  const sendItemOnInterfaces = sender.sendItemOnInterfaces.bind(sender);
  t.mock.method(sender, "sendItemOnInterfaces", (uid, id, zoom) => { if (uid === OBJECTBOX_ITEM) log.objects.push(id); return sendItemOnInterfaces(uid, id, zoom); });
  const sendSound = core.Sounds.sendSound;
  t.mock.method(core.Sounds, "sendSound", (player, sound, ...rest) => { if (player === p) log.sounds.push(sound.getId?.() ?? sound.id); return sendSound(player, sound, ...rest); });
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

function stage(f, quest, value) {
  QuestRuntime.questNamed(quest).setStage(f.p, value);
}

function hold(f, ...ids) {
  ids.forEach((id, slot) => f.inv.setItem(slot, new core.Item(id, 1)));
}

const slotOf = (f, id) => f.inv.getItems().findIndex((held) => held?.getId() === id);

function useOn(f, usedId, targetId) {
  const usedSlot = slotOf(f, usedId), targetSlot = slotOf(f, targetId);
  const event = {
    player: f.p, usedItem: f.inv.get(usedSlot), usedItemId: usedId, usedItemSlot: usedSlot,
    usedWithItem: f.inv.get(targetSlot), usedWithItemId: targetId, usedWithItemSlot: targetSlot, handled: false,
  };
  PM.emitItemOnItem(event);
  return event;
}

function answer(f, slot) {
  return MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot });
}

const crafting = (f) => f.p.getSkillManager().getExperience(core.Skill.CRAFTING);

test("a ruby on a silver sickle (b) asks first, then embeds it as recordings 102 and 1637 show", (t) => {
  const f = actor(t);
  stage(f, "Sins of the Father", 114);
  hold(f, I.RUBY, I.CHISEL, I.SILVER_SICKLE_B_);
  const event = useOn(f, I.RUBY, I.SILVER_SICKLE_B_);
  assert.equal(event.handled, true);
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p), { title: "Craft a ruby sickle?", options: ["Yes.", "No."] });
  assert.equal(f.inv.getAmount(I.RUBY), 1, "nothing is made before the answer");
  const xp = crafting(f);
  assert.equal(answer(f, 1), true);
  assert.equal(f.inv.getAmount(I.RUBY), 0);
  assert.equal(f.inv.getAmount(I.SILVER_SICKLE_B_), 0);
  assert.equal(slotOf(f, I.RUBY_SICKLE_B_), 0, "the sickle takes the first freed slot, the gem's");
  assert.equal(f.inv.getAmount(I.CHISEL), 1, "the chisel stays");
  assert.equal(crafting(f) - xp, 26, "Wiki: 26 Crafting XP");
  assert.deepEqual(f.log.animations, [887], "human_rubycutting");
  assert.deepEqual(f.log.sounds, [GEM_CUTTING_SOUND]);
  assert.deepEqual(f.log.mesboxes, ["You embed the ruby into the sickle."]);
  assert.equal(f.log.strings.get(OBJECTBOX_TEXT), "You embed the ruby into the sickle.");
  assert.deepEqual(f.log.objects, [I.RUBY_SICKLE_B_]);
});

test("No keeps the gem and the sickle", (t) => {
  const f = actor(t);
  stage(f, "Sins of the Father", 114);
  hold(f, I.SILVER_SICKLE_B_, I.RUBY, I.CHISEL);
  useOn(f, I.SILVER_SICKLE_B_, I.RUBY);
  answer(f, 2);
  assert.equal(f.inv.getAmount(I.RUBY), 1);
  assert.equal(f.inv.getAmount(I.SILVER_SICKLE_B_), 1);
  assert.equal(f.inv.getAmount(I.RUBY_SICKLE_B_), 0);
  assert.deepEqual(f.log.animations, []);
});

test("a gem gone while the menu is open makes nothing", (t) => {
  const f = actor(t);
  stage(f, "Sins of the Father", 114);
  hold(f, I.RUBY, I.CHISEL, I.SILVER_SICKLE_B_);
  useOn(f, I.RUBY, I.SILVER_SICKLE_B_);
  f.inv.deleteNumber(I.RUBY, 1);
  answer(f, 1);
  assert.equal(f.inv.getAmount(I.RUBY_SICKLE_B_), 0);
  assert.equal(f.inv.getAmount(I.SILVER_SICKLE_B_), 1);
});

test("a diamond on a silver sickle (b) during the preparations matches recording 4288", (t) => {
  const f = actor(t);
  stage(f, "The Blood Moon Rises", 60);
  hold(f, I.DIAMOND, I.SILVER_SICKLE_B_, I.CHISEL);
  useOn(f, I.DIAMOND, I.SILVER_SICKLE_B_);
  assert.equal(MultiChatboxPrompt.getPending(f.p)?.title, "Craft a diamond sickle?");
  const xp = crafting(f);
  answer(f, 1);
  assert.equal(slotOf(f, I.DIAMOND_SICKLE_B_), 0);
  assert.equal(crafting(f) - xp, 32, "Wiki: 32 Crafting XP");
  assert.deepEqual(f.log.animations, [886], "human_diamondcutting");
  assert.deepEqual(f.log.sounds, [GEM_CUTTING_SOUND]);
  assert.deepEqual(f.log.mesboxes, ["You embed the diamond into the sickle."]);
  assert.deepEqual(f.log.objects, [I.DIAMOND_SICKLE_B_]);
});

test("an emerald after starting A Taste of Hope gives the emerald sickle (b) and 20 XP", (t) => {
  const f = actor(t);
  stage(f, "A Taste of Hope", 1);
  hold(f, I.EMERALD, I.SILVER_SICKLE_B_, I.CHISEL);
  useOn(f, I.EMERALD, I.SILVER_SICKLE_B_);
  assert.equal(MultiChatboxPrompt.getPending(f.p)?.title, "Craft an emerald sickle?");
  const xp = crafting(f);
  answer(f, 1);
  assert.equal(f.inv.getAmount(I.EMERALD_SICKLE_B_), 1);
  assert.equal(crafting(f) - xp, 20, "Wiki: 20 Crafting XP");
  assert.deepEqual(f.log.animations, [889], "human_emeraldcutting");
});

test("without the quest step the use is left alone, and without a chisel it is refused", (t) => {
  const f = actor(t);
  hold(f, I.RUBY, I.SILVER_SICKLE_B_, I.CHISEL);
  const early = useOn(f, I.RUBY, I.SILVER_SICKLE_B_);
  assert.equal(early.handled, false, "no quest wants a ruby sickle yet");
  assert.equal(MultiChatboxPrompt.getPending(f.p), null);
  stage(f, "Sins of the Father", 114);
  f.inv.deleteNumber(I.CHISEL, 1);
  const noChisel = useOn(f, I.RUBY, I.SILVER_SICKLE_B_);
  assert.equal(noChisel.handled, true);
  assert.equal(MultiChatboxPrompt.getPending(f.p), null);
  assert.ok(f.log.messages.includes("You need a chisel to embed the ruby into the sickle."));
});
