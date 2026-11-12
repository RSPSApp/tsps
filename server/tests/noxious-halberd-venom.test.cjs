// Run after `yarn build`: node --test tests/noxious-halberd-venom.test.cjs
// Wiki (Noxious halberd, Venom): melee attacks envenom the target 33% of the time.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const { CombatPoisonData } = require('../dist/game/task/impl/CombatPoisonEffect');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { Item } = require('../dist/game/model/Item');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  CombatPoisonData.init();
});

const method = { type: () => CombatType.MELEE, accuracyDefenceType: () => undefined };
let nextIndex = 2400;

function meleeHit(t, weaponId, roll) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { NPC } = require('../dist/game/entity/impl/npc/NPC');
  const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
  const { Location } = require('../dist/game/model/Location');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new Location(3222, 3218));
  player.setIndex(nextIndex++); player.setUsername('noxioushalberd'); player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(weaponId));
  const target = NPC.create(NpcIdentifiers.MAN, new Location(3223, 3218));
  target.setIndex(nextIndex++); target.setRegistered(true);
  t.after(() => {
    player.setRegistered(false); target.setRegistered(false);
    TaskManager.cancelTasks(player.getIndex()); TaskManager.cancelTasks(target);
  });
  const hit = new PendingHit(player, target, method, {
    damage: 1, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
  });
  t.mock.method(Math, 'random', () => roll);
  try { CombatFactory.executeHit(hit); } finally { Math.random.mock.restore(); }
  return target;
}

for (const weapon of [ItemIdentifiers.NOXIOUS_HALBERD, ItemIdentifiers.NOXIOUS_HALBERD_4]) {
  test(`noxious halberd ${weapon} envenoms a damaging melee hit on a roll under 1/3`, (t) => {
    const target = meleeHit(t, weapon, 0.33);
    assert.equal(target.isVenomed(), true);
    assert.equal(target.getPoisonDamage(), 6);
  });

  test(`noxious halberd ${weapon} does not envenom on a roll of 1/3 or more`, (t) => {
    assert.equal(meleeHit(t, weapon, 0.34).isVenomed(), false);
  });
}

test('an ordinary melee weapon still cannot envenom', (t) => {
  assert.equal(meleeHit(t, ItemIdentifiers.RUNE_SCIMITAR, 0).isVenomed(), false);
});
