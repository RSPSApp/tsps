// Run after `yarn build`: node --test tests/fire-of-eternal-light.test.cjs
// Building a Fire of Eternal Light in an Old fire pit (Wiki: Old fire pit; rsprox_transcripts/226/01638.txt
// ticks 283 and 400). Real engine: every plugin loaded, a real Player and Inventory, Build sent through the
// object interaction the network uses, on the pit as the player sees it (its multiloc).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core;
let Skill;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Skill = core.Skill;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const QUEST_STAGE = "quest.making_friends_with_my_arm.stage";
const MOLE_PIT = { loc: "my2arm_fire_pit_mole", varbit: "my2arm_fire_mole", at: [1748, 5237, 0] };

let next = 9860;
function builder(t, { quest = true, levels = true, tools = true, materials = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("eternallight" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const messages = [];
  const sounds = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  const sendSoundEffect = sender.sendSoundEffect.bind(sender);
  t.mock.method(sender, "sendSoundEffect", (id, loops, delay, volume) => { sounds.push([id, delay]); return sendSoundEffect(id, loops, delay, volume); });
  if (quest) p.setAttribute(QUEST_STAGE, 200);
  if (levels) {
    p.getSkillManager().setMaxLevels(Skill.FIREMAKING, 66, false).setCurrentLevels(Skill.FIREMAKING, 66, false);
    p.getSkillManager().setMaxLevels(Skill.CONSTRUCTION, 35, false).setCurrentLevels(Skill.CONSTRUCTION, 35, false);
  }
  const I = core.ItemIdentifiers;
  const inv = p.getInventory();
  if (tools) for (const id of [I.HAMMER, I.SAW, I.TINDERBOX]) inv.add(new core.Item(id, 1), false);
  if (materials) {
    inv.add(new core.Item(I.MAHOGANY_PLANK, 1), false);
    inv.add(new core.Item(I.MAHOGANY_PLANK, 1), false);
    inv.add(new core.Item(I.STEEL_BAR, 1), false);
    inv.add(new core.Item(I.STEEL_BAR, 1), false);
    inv.add(new core.Item(I.TE_SALT, 803), false);
    inv.add(new core.Item(I.EFH_SALT, 658), false);
    inv.add(new core.Item(I.URT_SALT, 824), false);
  }
  return { p, messages, sounds };
}

function build(p, pit = MOLE_PIT, definition = null) {
  const objectId = core.CacheDefinitions.getLocId(pit.loc);
  definition ??= ObjectDefinition.forPlayer(objectId, p);
  assert.equal(definition.getName(), "Old fire pit");
  const [x, y, z] = pit.at;
  const object = new core.GameObject(objectId, new core.Location(x, y, z), 10, 0, null);
  const event = { player: p, object, definition, objectId, clickType: 1, option: "build", location: { x, y, z }, handled: false };
  return PM.emitObjectInteraction(event);
}

const varbit = (p, name) => p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name));

test("Build uses the planks, bars and salts, lights the fire and gives the recorded experience (226/01638 tick 400)", (t) => {
  const f = builder(t);
  const I = core.ItemIdentifiers;
  const skills = f.p.getSkillManager();
  const before = { fm: skills.getExperience(Skill.FIREMAKING), con: skills.getExperience(Skill.CONSTRUCTION) };
  const animations = [];
  t.mock.method(f.p, "performAnimation", (animation) => animations.push(animation.getId()));
  const pit = ObjectDefinition.forPlayer(core.CacheDefinitions.getLocId(MOLE_PIT.loc), f.p);
  assert.equal(build(f.p), true);
  assert.equal(varbit(f.p, MOLE_PIT.varbit), 1, "my2arm_fire_mole 0 -> 1");
  assert.equal(ObjectDefinition.forPlayer(core.CacheDefinitions.getLocId(MOLE_PIT.loc), f.p).getName(), "Fire of Eternal Light");
  const inv = f.p.getInventory();
  assert.equal(inv.getAmount(I.MAHOGANY_PLANK), 0);
  assert.equal(inv.getAmount(I.STEEL_BAR), 0);
  assert.equal(inv.getAmount(I.TE_SALT), 503);
  assert.equal(inv.getAmount(I.EFH_SALT), 558);
  assert.equal(inv.getAmount(I.URT_SALT), 774);
  assert.equal(inv.getAmount(I.HAMMER), 1, "tools are kept");
  assert.equal(inv.getAmount(I.TINDERBOX), 1);
  assert.deepEqual(f.sounds, [[938, 0], [2596, 30]], "poh_build_wood, then fire_lit delay 30");
  assert.deepEqual(animations, [core.CacheDefinitions.getSeqId("human_poh_build")]);
  assert.deepEqual(f.messages, [], "no chat line on success");
  // 300 and 350 before the world's experience rate (226/01638 tick 400 update_stat_v2).
  const fm = skills.getExperience(Skill.FIREMAKING) - before.fm;
  const con = skills.getExperience(Skill.CONSTRUCTION) - before.con;
  assert.ok(fm > 0 && con > 0, `${fm} ${con}`);
  assert.equal(con / fm, 350 / 300, "Construction 350 to Firemaking 300");
  assert.equal(f.p.getAttribute("fire-of-eternal-light:mole-hole"), true, "saved");

  // A second Build sent before the pit changed (double click) uses nothing more.
  build(f.p, MOLE_PIT, pit);
  assert.equal(inv.getAmount(I.TE_SALT), 503);

  // Varbits aren't saved: login sends the built fire again.
  f.p.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(MOLE_PIT.varbit), 0);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(varbit(f.p, MOLE_PIT.varbit), 1);
});

test("short of materials it says the recorded line and takes nothing (226/01638 tick 283)", (t) => {
  const f = builder(t);
  f.p.getInventory().delete(core.ItemIdentifiers.URT_SALT, 800);
  build(f.p);
  assert.deepEqual(f.messages, ["You need 2 Steel Bars, 2 Mahogany Planks, 300 Te Salt, 100 Efh Salt, and 50 Urt Salt to build this."]);
  assert.equal(varbit(f.p, MOLE_PIT.varbit), 0);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.STEEL_BAR), 2);
});

test("before Making Friends with My Arm it says the Wiki's line; without the levels or a tool nothing is built", (t) => {
  const noQuest = builder(t, { quest: false });
  build(noQuest.p);
  assert.deepEqual(noQuest.messages, ["You can't see what would burn very well here. Perhaps you should complete Making Friends with My Arm first."]);
  assert.equal(varbit(noQuest.p, MOLE_PIT.varbit), 0);

  const low = builder(t);
  low.p.getSkillManager().setMaxLevels(Skill.FIREMAKING, 65, false).setCurrentLevels(Skill.FIREMAKING, 70, false);
  build(low.p);
  assert.equal(varbit(low.p, MOLE_PIT.varbit), 0, "Firemaking can't be boosted");

  const noSaw = builder(t);
  noSaw.p.getInventory().delete(core.ItemIdentifiers.SAW, 1);
  build(noSaw.p);
  assert.equal(varbit(noSaw.p, MOLE_PIT.varbit), 0);
  assert.equal(noSaw.p.getInventory().getAmount(core.ItemIdentifiers.STEEL_BAR), 2);
});

test("the Lumbridge Swamp Caves fire lights that dark area; other pits' fires are not built here", (t) => {
  const f = builder(t);
  const Darkness = require("../plugins/world/Darkness.plugin");
  const cave = new core.Location(3168, 9572, 0);
  assert.equal(Darkness.darkAreaAt(cave)?.name, "Lumbridge Swamp Caves");
  assert.equal(Darkness.canSeeAt(f.p, cave), false);
  assert.equal(build(f.p, { loc: "my2arm_fire_pit_lumb", varbit: "my2arm_fire_lumb", at: [3168, 9572, 0] }), true);
  assert.equal(varbit(f.p, "my2arm_fire_lumb"), 1);
  assert.equal(Darkness.canSeeAt(f.p, cave), true);

  const g = builder(t);
  const gwd = core.CacheDefinitions.getLocId("my2arm_fire_pit_gwd");
  const object = new core.GameObject(gwd, new core.Location(2916, 3746, 0), 10, 0, null);
  const event = { player: g.p, object, definition: ObjectDefinition.forPlayer(gwd, g.p), objectId: gwd, clickType: 1, option: "build", location: { x: 0, y: 0, z: 0 }, handled: false };
  PM.emitObjectInteraction(event);
  assert.equal(varbit(g.p, "my2arm_fire_gwd"), 0);
  assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.STEEL_BAR), 2);
});
