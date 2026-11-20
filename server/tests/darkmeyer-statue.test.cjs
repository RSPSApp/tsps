// Run after `yarn build`: node --test tests/darkmeyer-statue.test.cjs
//
// The Darkmeyer statue (loc darkm_altar, 39234): Pray-at restores all Prayer for a blood sacrifice of 1-3 Hitpoints,
// which can kill (the Wiki: Darkmeyer, Statue (Darkmeyer)). rsprox 3050 (rev 231): t61 the pray animation, synth 2674
// and "The statue takes a blood sacrifice from you as you recharge your Prayer points." (spam), then a tick later the
// hit with synth 518 (delay 20); t43 at full Prayer, "You already have full Prayer points." (game message).
// The real plugin's Pray-at handler, a real Player and the real task queue.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { Sounds } = require("../dist/game/Sounds");

const STATUE = 39234;
const DARKMEYER = { x: 3604, y: 3354, z: 0 };
const MUSEUM = { x: 2985, y: 9976, z: 0 };
const MESSAGE = "The statue takes a blood sacrifice from you as you recharge your Prayer points.";

let core;
let altars;
const interactions = new Map();
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  altars = require("../plugins/objects/Altars.plugin");
  altars.register(new Proxy({
    core, onObjectInteraction: (name, actions) => interactions.set(name, actions),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function actor(t, { prayer = 10, hitpoints = 50 } = {}) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("darkmstatue");
  p.getSkillManager().setMaxLevel(core.Skill.PRAYER, 70).setCurrentLevel(core.Skill.PRAYER, prayer);
  p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99).setCurrentLevel(core.Skill.HITPOINTS, hitpoints);
  const f = { p, game: [], typed: [], sounds: [], animations: [] };
  t.mock.method(p, "sendMessage", (m) => f.game.push(m));
  const sender = p.getPacketSender();
  const sendTyped = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, "sendTypedMessage", (type, text, ...rest) => { f.typed.push([type, text]); return sendTyped(type, text, ...rest); });
  const sendSound = sender.sendSound.bind(sender);
  t.mock.method(sender, "sendSound", (id, volume, delay) => { f.sounds.push([id, delay]); return sendSound(id, volume, delay); });
  // A bot session hears no Sounds.sendSound, so the cue is read where the plugin sends it.
  t.mock.method(Sounds, "sendSound", (entity, sound) => { if (entity === p) f.sounds.push([sound.id, sound.delay]); });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { f.animations.push(animation.getId()); return perform(animation); });
  t.after(() => core.TaskManager.cancelTasks(p));
  return f;
}

const pending = (p) => p.getCombat().getHitQueue().pendingDamage.map((hit) => hit.getDamage());

function pray(f, location = DARKMEYER, random = () => 0.99) {
  return altars._test.prayAtDarkmeyerStatue({ player: f.p, objectId: STATUE, location }, random);
}

test("the hook is the statue's Pray-at", () => {
  assert.equal(typeof interactions.get("Statue")?.["Pray-at"], "function");
});

test("Pray-at restores all Prayer, then takes 1-3 Hitpoints the next tick", (t) => {
  const f = actor(t);
  assert.equal(pray(f), true);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 70);
  assert.deepEqual(f.animations, [645]);
  assert.deepEqual(f.sounds, [[2674, 0]]);
  assert.deepEqual(f.typed, [[core.ChatType.SPAM, MESSAGE]]);
  assert.deepEqual(f.game, []);
  assert.deepEqual(pending(f.p), [], "no hit on the click's tick");
  core.TaskManager.process();
  assert.deepEqual(pending(f.p), [3]);
  assert.deepEqual(f.sounds, [[2674, 0], [518, 20]]);
});

test("the sacrifice is 1 to 3 Hitpoints", (t) => {
  for (const [roll, damage] of [[0, 1], [0.5, 2], [0.999, 3]]) {
    const f = actor(t);
    pray(f, DARKMEYER, () => roll);
    core.TaskManager.process();
    assert.deepEqual(pending(f.p), [damage]);
  }
});

test("the sacrifice isn't capped at the last Hitpoint: it can kill", (t) => {
  const f = actor(t, { hitpoints: 2 });
  pray(f);
  core.TaskManager.process();
  assert.deepEqual(pending(f.p), [3]);
  // The hit queue drops an unregistered player's damage, so the drain needs a registered one.
  f.p.setRegistered(true);
  t.after(() => f.p.setRegistered(false));
  f.p.getCombat().getHitQueue().process(1);
  assert.equal(f.p.getHitpoints(), 0);
});

test("at full Prayer it only says so, and takes nothing", (t) => {
  const f = actor(t, { prayer: 70 });
  assert.equal(pray(f), true);
  assert.deepEqual(f.game, ["You already have full Prayer points."]);
  assert.deepEqual(f.typed, []);
  assert.deepEqual(f.animations, []);
  core.TaskManager.process();
  assert.deepEqual(pending(f.p), []);
});

test("the Old School Museum's copy (same id) is left alone", (t) => {
  const f = actor(t);
  assert.equal(pray(f, MUSEUM), false);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 10);
  core.TaskManager.process();
  assert.deepEqual(pending(f.p), []);
});

test("another loc named Statue with Pray-at falls through", (t) => {
  const f = actor(t);
  assert.equal(altars._test.prayAtDarkmeyerStatue({ player: f.p, objectId: 1, location: DARKMEYER }), false);
});
