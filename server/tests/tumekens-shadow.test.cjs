// Run after `yarn build`: node --test tests/tumekens-shadow.test.cjs
// Tumeken's shadow (plugins/items/TumekensShadow.plugin.js, docs/tumekens-shadow.md).
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

test("Tumeken's shadow: its own spell, the x3 (x4 in the tombs) passive and charges (Wiki)", () => {
  // Its definition: the powered staff's styles and its own bonuses (Wiki: +35 magic attack,
  // +20 magic defence, +1 prayer, two-handed, 85 Magic).
  const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
  const raw = require('../data/definitions/item-gameplay.json');
  for (const id of [27275, 27277]) {
    const entry = raw.find((item) => item.id === id);
    assert.equal(entry.weaponInterface, 'POWERED_STAFF');
    assert.deepEqual(entry.bonuses, [0, 0, 0, 35, 0, 0, 0, 0, 20, 0, 0, 0, 0, 1]);
    assert.equal(entry.requirements[6], 85);
    assert.equal(entry.doubleHanded, true);
  }
  assert.equal(WeaponInterfaces.POWERED_STAFF.getCategory(), 24);
  assert.deepEqual(WeaponInterfaces.POWERED_STAFF.getFightType().map((type) => type.getChildId()), [0, 1, 3]);
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const { Location } = require('../dist/game/model/Location');
  const { Item } = require('../dist/game/model/Item');
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  const Shadow = require('../plugins/items/TumekensShadow.plugin');
  const resolvers = [];
  const providers = [];
  const updates = [];
  const api = {
    core: PluginManager.getCoreApi(),
    registerCombatMethodResolver: (resolver) => resolvers.push(resolver),
    registerBonusProvider: (provider) => providers.push(provider),
    getBonusManager: () => ({ update: (player) => updates.push(player) }),
    onItemOnItem: () => {},
    onItemAction: () => {},
    // The Tombs of Amascut plugin's answer (Raid.TombsOfAmascut.js).
    emitCustomEvent: (name, query) => { if (name === 'toa:in-tombs' && Shared.inTombs(query.player.getLocation())) query.inside = true; },
  };
  Shadow.register(api);

  const staff = new Item(I.TUMEKENS_SHADOW, 1);
  staff.setMetaValue(Shadow.CHARGES_KEY, 2);
  const equipment = new Array(14).fill(null);
  equipment[3] = staff;
  let location = new Location(3200, 3200, 0);
  let castSpell = null;
  const messages = [];
  const player = {
    isPlayer: () => true, getAsPlayer: () => player,
    getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
    getLocation: () => location,
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getCombat: () => ({ setCastSpell: (spell) => { castSpell = spell; }, reset: () => {} }),
    getUpdateFlag: () => ({ flag: () => {} }),
    sendMessage: (message) => messages.push(message),
  };
  const npc = { isPlayer: () => false };

  const method = resolvers[0].resolve(player);
  assert.ok(method, 'the shadow attacks with its own method, not a kick');
  assert.equal(method.attackSpeed(player), 5);
  assert.equal(method.attackDistance(player), 8);
  const { FightType } = require('../dist/game/content/combat/FightType');
  player.getFightType = () => FightType.POWERED_STAFF_LONGRANGE;
  assert.equal(method.attackDistance(player), 10, 'Longrange reaches 2 tiles further');

  // Passive: occult (+10%) and a +35 staff: x3 outside, x4 in the tombs, damage capped at 100%.
  const bonuses = () => { const b = new Array(14).fill(0); b[3] = 35; b[12] = 10; return b; };
  let worn = bonuses();
  providers[0].apply({ player, bonuses: worn });
  assert.deepEqual([worn[3], worn[12]], [105, 30]);
  location = new Location(3700, 5200, 0);
  worn = bonuses();
  providers[0].apply({ player, bonuses: worn });
  assert.deepEqual([worn[3], worn[12]], [140, 40]);
  worn = bonuses();
  worn[12] = 40;
  providers[0].apply({ player, bonuses: worn });
  assert.equal(worn[12], 100, 'magic damage caps at 100%');

  // A cast selects its built-in spell (max hit floor(99 / 3) + 1) and spends a charge.
  assert.equal(method.canAttack(player, npc), true);
  assert.equal(castSpell.maximumHit(), 34);
  // The cast as captured: sound 6410, the projectile at angle 32 and progress 40, heights sent x4.
  assert.equal(castSpell.castSound().getId(), 6410);
  // Its impact: `sound_area id=1460 range=10` at the target in 672 casts (captures 1846, 1885, 3285, 3299, 3340).
  assert.equal(castSpell.impactSound()?.getId(), 1460);
  const at = (x, y) => ({ getLocation: () => new Location(x, y, 0), getSize: () => 1, getPrivateArea: () => null });
  const projectile = castSpell.castProjectile(at(3200, 3200), at(3204, 3200));
  assert.deepEqual([projectile.angle, projectile.progress, projectile.startHeight, projectile.endHeight], [32, 40, 62, 31]);
  // Its end cycle is 72 + 10 a tile, a tile being the distance to the target's NEAREST tile (rsprox 3299, rev 234,
  // Theatre of Blood Nylocas): Vasilias (size 4, south-west tile 3295,4248) from 3295,4252 ends at 82 where its
  // south-west tile is 4 away (112); a big Nylocas (size 2, 3293,4243) from 3294,4245 at 82 (SW: 92) and from
  // 3293,4248 to 3298,4243 at 122; size-1 Nylocas at 6 and 8 tiles at 132 and 152.
  const sized = (x, y, size) => ({ getLocation: () => new Location(x, y, 0), getSize: () => size, getPrivateArea: () => null });
  const ends = [
    [sized(3295, 4252, 1), sized(3295, 4248, 4), 82],
    [sized(3294, 4245, 1), sized(3293, 4243, 2), 82],
    [sized(3293, 4248, 1), sized(3298, 4243, 2), 122],
    [sized(3292, 4246, 1), sized(3291, 4252, 1), 132],
    [sized(3292, 4246, 1), sized(3300, 4252, 1), 152],
  ];
  assert.deepEqual(ends.map(([from, to]) => castSpell.castProjectile(from, to).speed), ends.map(([, , end]) => end));
  assert.equal(staff.getMetaValue(Shadow.CHARGES_KEY), 1);
  assert.equal(method.canAttack(player, npc), true);
  assert.equal(staff.getId(), I.TUMEKENS_SHADOW_UNCHARGED_, 'the last charge leaves it uncharged');
  assert.equal(method.canAttack(player, npc), false);
  assert.match(messages.at(-1), /no charges/);
  staff.setId(I.TUMEKENS_SHADOW);
  staff.setMetaValue(Shadow.CHARGES_KEY, 5);
  assert.equal(method.canAttack(player, { isPlayer: () => true }), false, 'not against players');
});
