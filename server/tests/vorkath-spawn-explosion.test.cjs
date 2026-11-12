// Run after `yarn build`: node --test tests/vorkath-spawn-explosion.test.cjs
// The zombified spawn's explosion as recorded (rsprox.net recs 127/129/543 rev 227, 3280 rev 234): on the tick it
// reaches the player the spawn plays ds2_spawn_attack (7890), watersurge_impact (1460) lands on its tile with delay 22
// and height 30, the player hears synth sounds 232 and 208 (delay 22) and reads the red "violently explodes" line.
// Real engine: every plugin loaded, a real Vorkath, spawn and Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Specials, Shared;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Specials = require("../plugins/bosses/vorkath/Specials.Vorkath");
  Shared = require("../plugins/bosses/vorkath/Shared.Vorkath");
});
after(() => PM.emitServerShutdown({}));

test("the spawn's explosion plays its attack, graphic, sounds and message on the tick it reaches the player", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9994); p.setUsername("spawnfoe"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2272, 4054, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });

  const messages = [];
  const sounds = [];
  const sendMessage = p.sendMessage.bind(p);
  p.sendMessage = (text) => { messages.push(text); return sendMessage(text); };
  const sender = p.getPacketSender();
  const sendSoundEffect = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, loops, delay) => { sounds.push([id, delay ?? 0]); return sendSoundEffect(id, loops, delay); };

  const graphics = [];
  const tileGraphic = Shared.tileGraphic;
  Shared.tileGraphic = (c, npc, gfxId, height, tile, delay) => { graphics.push({ gfxId, height, tile, delay }); return []; };
  t.after(() => { Shared.tileGraphic = tileGraphic; });

  const vorkath = core.NPC.create(core.NpcIdentifiers.VORKATH, new core.Location(2269, 4062, 0));
  vorkath.setRegistered?.(true);
  t.after(() => { Specials.endFight(vorkath); vorkath.setRegistered?.(false); core.TaskManager.cancelTasks(vorkath); });
  const spawn = core.NPC.create(Shared.SPAWN_ID, new core.Location(2272, 4055, 0));
  spawn.setRegistered?.(true);
  t.after(() => { spawn.setRegistered?.(false); core.TaskManager.cancelTasks(spawn); });
  const animations = [];
  const performAnimation = spawn.performAnimation.bind(spawn);
  spawn.performAnimation = (animation) => { animations.push(animation.getId?.() ?? animation.id); return performAnimation(animation); };

  vorkath.setAttribute(Shared.ATTR_PHASE, Shared.PHASE_SPAWN);
  const fight = { pools: new Map(), spawn, fighter: p, exploding: false };
  Specials.fights.set(vorkath, fight);
  Specials._test.finishExplosion(vorkath, fight, spawn, p);

  assert.deepEqual(messages, ["<col=ff3045>The spawn violently explodes, unfreezing you as it does so.</col>"]);
  assert.deepEqual(animations, [7890], "ds2_spawn_attack");
  assert.deepEqual(graphics, [{ gfxId: 1460, height: 30, tile: { x: 2272, y: 4055 }, delay: 22 }]);
  assert.deepEqual(sounds, [[232, 0], [208, 22]]);

  // A second call in the same explosion sends nothing more.
  Specials._test.finishExplosion(vorkath, fight, spawn, p);
  assert.equal(messages.length, 1);
});
