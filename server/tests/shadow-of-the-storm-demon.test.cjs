// Run after `yarn build`: node --test tests/shadow-of-the-storm-demon.test.cjs
//
// #2577, Agrith-Naar's pull. Rsprox 572 (rev 227): at t1385 he casts (sequence 69) with projectile 143
// at the player, two tiles out of melee, with sounds 3006 and 3007; at t1388 the player is moved with
// spotanim 409 and sound 1851. So it travels for 3 ticks at this distance. The condition is the Wiki's
// quest page: out of melee with Protect from Magic. It is the only pull in 572 and 3333. His next attack
// is 6 ticks after it, the only evidence for the rate; this test doesn't pin one.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const OUT_OF_MELEE = [2720, 4903, 2];
const IN_MELEE = [2720, 4902, 2];
const STAGE_SUMMONED = 120;

let core;
let next = 9200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(OUT_OF_MELEE[0], OUT_OF_MELEE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.name === "Shadow of the Storm");

function fight(t, tile, protectMagic) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("demonqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(tile[0], tile[1], tile[2]));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  quest().setStage(p, STAGE_SUMMONED);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.SILVERLIGHT_2), false);
  PM.emitPlayerLogin({ player: p, username: p.getUsername(), isNewAccount: false });
  const demon = [...core.World.getNpcs()].find((npc) => npc.getOwner?.() === p && npc.getId() === core.NpcIdentifiers.AGRITH_NAAR);
  assert.ok(demon, "control: the fight restores the demon");
  p.setLocation(new core.Location(tile[0], tile[1], tile[2]));
  p.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MAGIC] = protectMagic;

  const projectiles = [];
  const createProjectile = core.Projectile.createProjectile.bind(core.Projectile);
  t.mock.method(core.Projectile, "createProjectile", (...args) => { projectiles.push(args[2]); return createProjectile(...args); });
  const graphics = [];
  const performGraphic = p.performGraphic.bind(p);
  t.mock.method(p, "performGraphic", (graphic) => { graphics.push(graphic.getId()); return performGraphic(graphic); });
  const sounds = [];
  const sender = p.getPacketSender();
  const sendAreaSound = sender.sendAreaSound.bind(sender);
  t.mock.method(sender, "sendAreaSound", (id, ...rest) => { sounds.push(id); return sendAreaSound(id, ...rest); });
  return { p, demon, method: CombatFactory.getMethod(demon), projectiles, graphics, sounds };
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];

function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

test("the pull is cast, travels for three ticks, and then moves the player beside him", (t) => {
  const f = fight(t, OUT_OF_MELEE, true);
  f.method.start(f.demon, f.p);
  assert.deepEqual(f.projectiles, [143], "the grab's projectile, not Fire Blast's");
  assert.deepEqual(f.sounds, [3006, 3007], "the cast's sound, and the landing's");
  assert.deepEqual(at(f), OUT_OF_MELEE, "not moved on the cast");
  ticks(2);
  assert.deepEqual(at(f), OUT_OF_MELEE, "not moved while it travels");
  assert.deepEqual(f.graphics, []);
  ticks(1);
  assert.notDeepEqual(at(f), OUT_OF_MELEE, "moved when it lands");
  assert.equal(core.CombatRange.canReach(f.demon, core.CombatFactory.MELEE_COMBAT, f.p), true, "and in melee");
  assert.deepEqual(f.graphics, [409]);
  assert.deepEqual(f.sounds, [3006, 3007, 1851]);
});

test("a player who walks into melee while it travels is not moved", (t) => {
  const f = fight(t, OUT_OF_MELEE, true);
  f.method.start(f.demon, f.p);
  f.p.setLocation(new core.Location(...IN_MELEE));
  ticks(3);
  assert.deepEqual(at(f), IN_MELEE);
  assert.deepEqual(f.graphics, []);
});

test("control: out of melee without Protect from Magic he casts Fire Blast, and nobody moves", (t) => {
  const f = fight(t, OUT_OF_MELEE, false);
  f.method.start(f.demon, f.p);
  assert.deepEqual(f.projectiles, [130]);
  ticks(3);
  assert.deepEqual(at(f), OUT_OF_MELEE);
});

test("control: in melee there is no pull", (t) => {
  const f = fight(t, IN_MELEE, true);
  f.method.start(f.demon, f.p);
  assert.deepEqual(f.projectiles, []);
  ticks(3);
  assert.deepEqual(at(f), IN_MELEE);
});
