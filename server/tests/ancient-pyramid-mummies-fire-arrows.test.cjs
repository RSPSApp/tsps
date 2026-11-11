// Run after `yarn build`: node --test tests/ancient-pyramid-mummies-fire-arrows.test.cjs
// Wiki (Mummy (Ancient Pyramid)): "Mummies attacked with fire spells or fire arrows will be set alight."
// Real plugins, a real Player wearing the arrows and a real mummy NPC; the hit goes through the
// plugin manager's hit-damage event as PendingHit emits it.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function rangedHit(arrow, damage = 4, weapon = core.ItemIdentifiers.MAGIC_SHORTBOW) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel)); player.setIndex(2741); player.setUsername('mummyarrows');
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, weapon === core.ItemIdentifiers.MAGIC_SHORTBOW ? 1 : 100));
  player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(arrow, 100));
  const mummy = core.NPC.create(core.NpcIdentifiers.MUMMY_3, new core.Location(3227, 2846, 0));
  PM.emitCombatHitDamage({ attacker: player, target: mummy, combatType: core.CombatType.RANGED, hit: {},
    damage: { getDamage: () => damage }, accurate: true });
  return mummy.getNpcTransformationId?.() ?? mummy.getTransformationId?.();
}

test('lit fire arrows set an Ancient Pyramid mummy alight', () => {
  for (const arrow of [core.ItemIdentifiers.BRONZE_FIRE_ARROW_LIT_, core.ItemIdentifiers.RUNE_FIRE_ARROW_LIT_,
    core.ItemIdentifiers.AMETHYST_FIRE_ARROW_LIT_, core.ItemIdentifiers.DRAGON_FIRE_ARROW_LIT_]) {
    assert.equal(rangedHit(arrow), core.NpcIdentifiers.MUMMY_8, `arrow ${arrow}`);
  }
});

test('unlit fire arrows, plain arrows and a zero hit leave it as it is', () => {
  for (const arrow of [core.ItemIdentifiers.BRONZE_FIRE_ARROW, core.ItemIdentifiers.RUNE_ARROW]) {
    assert.notEqual(rangedHit(arrow), core.NpcIdentifiers.MUMMY_8, `arrow ${arrow}`);
  }
  assert.notEqual(rangedHit(core.ItemIdentifiers.RUNE_FIRE_ARROW_LIT_, 0), core.NpcIdentifiers.MUMMY_8);
});

// The arrow only counts when the bow fires it: a thrown weapon or a chinchompa fires itself, whatever is worn.
test('a knife, dart or chinchompa thrown while lit fire arrows are worn leaves it as it is', () => {
  for (const weapon of [core.ItemIdentifiers.RUNE_KNIFE, core.ItemIdentifiers.RUNE_DART, core.ItemIdentifiers.CHINCHOMPA_2]) {
    assert.notEqual(rangedHit(core.ItemIdentifiers.RUNE_FIRE_ARROW_LIT_, 4, weapon), core.NpcIdentifiers.MUMMY_8, `weapon ${weapon}`);
  }
});
