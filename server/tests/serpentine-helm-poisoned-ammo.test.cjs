// Run after `yarn build`: node --test tests/serpentine-helm-poisoned-ammo.test.cjs
// Serpentine helm (Wiki): a poisoned weapon or ammunition raises the envenom chance to 1/2. Real
// plugins, a real Player wearing the helm, a bow and (p++) arrows, and a real NPC; the combat
// ammunition is resolved as CombatFactory does before an attack, and the hit goes through the
// plugin manager's hit-resolved event.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Ammunition } = require('../dist/game/content/combat/ranged/RangedData');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function shoot(t, arrow, roll) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel)); player.setIndex(2742); player.setUsername('serphelmammo');
  const helm = new core.Item(core.ItemIdentifiers.SERPENTINE_HELM, 1);
  helm.setMetaValue('serpentine-helm', 1000);
  player.getEquipment().setItem(core.Equipment.HEAD_SLOT, helm);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.MAGIC_SHORTBOW, 1));
  player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(arrow, 100));
  player.getCombat().setAmmunition(Ammunition.getFor(player));
  const npc = core.NPC.create(core.NpcIdentifiers.GOBLIN, new core.Location(3200, 3200, 0));
  const random = Math.random;
  Math.random = () => roll;
  t.after(() => { Math.random = random; });
  PM.emitCombatHitResolved({ attacker: player, target: npc,
    hit: { isAccurate: () => true, getTotalDamage: () => 5, getCombatType: () => core.CombatType.RANGED, getHandleAfterHitEffects: () => false } });
  Math.random = random;
  return npc.isVenomed();
}

test('poisoned arrows envenom on a roll under 1/2', (t) => {
  assert.equal(shoot(t, core.ItemIdentifiers.RUNE_ARROW_P_PLUS_PLUS_, 0.4), true);
  assert.equal(shoot(t, core.ItemIdentifiers.RUNE_ARROW_P_, 0.4), true);
});

test('plain arrows do not, and a roll of 1/2 does not', (t) => {
  assert.equal(shoot(t, core.ItemIdentifiers.RUNE_ARROW, 0), false);
  assert.equal(shoot(t, core.ItemIdentifiers.RUNE_ARROW_P_PLUS_PLUS_, 0.5), false);
});
