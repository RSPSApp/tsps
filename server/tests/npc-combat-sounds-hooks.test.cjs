// Run after `yarn build`, from server/: node --test tests/npc-combat-sounds-hooks.test.cjs
//
// The hooks that play NPC combat sounds, on real engine objects: a real Player hitting a real NPC through
// CombatFactory.executeHit. A player's spell that splashes puts no hitsplat on the NPC and live plays no hit
// sound for it (rsprox 226/01696: a Sanguinesti splash is silent, the next accurate cast lands a hitsplat and
// the sound). NPC 448 has a captured hit sound (379).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');

const HOME = [3222, 3218];
const NPC_ID = 448;
const HIT_SOUND = 379;
let core;
let next = 2300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
});
after(() => PluginManager.emitServerShutdown({}));

function fighter(t) {
  const channel = {
    kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername('npcsnd' + player.getIndex());
  player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(HOME[0], HOME[1], 0));
  player.needsPlacement = false;
  const heard = [];
  const sender = player.getPacketSender();
  const send = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, ...rest) => { heard.push(id); return send(id, ...rest); };
  const npc = new core.NPC(NPC_ID, new core.Location(HOME[0] + 1, HOME[1], 0));
  npc.setHitpoints(200);
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, npc, heard };
}

test('a melee hit on the NPC plays its hit sound to the attacker', (t) => {
  const f = fighter(t);
  CombatFactory.executeHit(new PendingHit(f.player, f.npc, CombatFactory.MELEE_COMBAT, 0));
  assert.deepEqual(f.heard, [HIT_SOUND]);
});

test('a player\'s spell that splashes plays no hit sound', (t) => {
  const f = fighter(t);
  const splash = new PendingHit(f.player, f.npc, CombatFactory.MAGIC_COMBAT, 0);
  splash.accurate = false;
  const before = f.npc.getHitpoints();
  CombatFactory.executeHit(splash);
  assert.equal(f.npc.getHitpoints(), before, 'a splash does no damage');
  assert.deepEqual(f.heard, []);
});
