// Wiki: Eclipse atlatl / Atlatl dart. IDs checked against the revision 241 cache.
let core;
let pluginApi;
let atlatlIds;
let method;
const setHits = new WeakSet();

function usingAtlatl(player) {
  return atlatlIds.has(player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId());
}

function hasFullSet(player) {
  const { Equipment: E, ItemIdentifiers: I } = core;
  const equipment = player.getEquipment();
  return [I.ECLIPSE_MOON_HELM, I.ECLIPSE_MOON_HELM_4, I.ECLIPSE_MOON_HELM_6].includes(equipment.get(E.HEAD_SLOT).getId())
    && [I.ECLIPSE_MOON_CHESTPLATE, I.ECLIPSE_MOON_CHESTPLATE_4, I.ECLIPSE_MOON_CHESTPLATE_6].includes(equipment.get(E.BODY_SLOT).getId())
    && [I.ECLIPSE_MOON_TASSETS, I.ECLIPSE_MOON_TASSETS_4, I.ECLIPSE_MOON_TASSETS_6].includes(equipment.get(E.LEG_SLOT).getId());
}

function fullSetQuery(query) {
  query.fullSet = hasFullSet(query.player);
}

function attackSpeed(event) {
  if (event.combatType === core.CombatType.RANGED && event.attacker.isPlayer() && event.target.isPlayer()
      && usingAtlatl(event.attacker.getAsPlayer()) && !hasFullSet(event.attacker.getAsPlayer())) {
    event.speed++;
  }
}

function resolveMethod(attacker) {
  if (!attacker.isPlayer()) return null;
  const player = attacker.getAsPlayer();
  return !player.isSpecialActivated() && usingAtlatl(player) ? method : null;
}

function createMethod() {
  return new (class EclipseAtlatlCombatMethod extends core.RangedCombatMethod {
    hits(character, target) {
      const hits = super.hits(character, target);
      if (hasFullSet(character.getAsPlayer())) {
        for (const hit of hits) setHits.add(hit);
      }
      return hits;
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) return;
      hit.getTarget().performGraphic(new core.Graphic(2796)); // vfx_atlatl_impact_01
      if (setHits.has(hit) && Math.random() < 0.2) {
        pluginApi.emitCustomEvent("combat:burn", {
          attacker: hit.getAttacker(), target: hit.getTarget(), damage: 10, severity: "strong",
        });
      }
    }
  })();
}

function registerAtlatlProfile(api) {
  core = api.core;
  pluginApi = api;
  const { Ammunition, FightType, ItemIdentifiers: I, RangedWeapon, RangedWeaponType, Sound } = core;
  atlatlIds = new Set([I.ECLIPSE_ATLATL, I.ECLIPSE_ATLATL_4]);
  const type = new RangedWeaponType(6, 8, FightType.SHORTBOW_LONGRANGE);
  new RangedWeapon([I.ECLIPSE_ATLATL], [new Ammunition(I.ATLATL_DART, null, 2795, 0)], type);
  new RangedWeapon([I.ECLIPSE_ATLATL_4], [new Ammunition(I.ATLATL_DART_3, null, 2795, 0)], type);
  api.registerWeaponProfile({
    itemIds: [...atlatlIds],
    attackAnimation: 11057, // human_atlatl_attack_ranged_01
    attackSpeed: 4,
    attackDistance: 6,
    longRangeFightType: FightType.SHORTBOW_LONGRANGE,
    rangedDamageSource: "melee_strength",
    rangedDefenceType: "standard",
    projectileId: 2795,
    startGraphic: false,
    fireSound: Sound.THROW_DART,
    boltEffects: false,
    hitDelays: [{ base: 1, distanceOffset: 3, divisor: 6 }],
    // RSProx 4014/4021: launch 41, heights 163 -> 146, angle 15, progress 11.
    projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 40.75, endHeight: 36.5, angle: 15, progress: 11 }],
  });
  method = createMethod();
}

module.exports = {
  name: "EclipseAtlatl",
  members: true,
  register(api) {
    registerAtlatlProfile(api);
    api.registerCombatMethodResolver({ resolve: resolveMethod });
    api.onAttackSpeed(attackSpeed);
    api.onCustomEvent("eclipse-atlatl:full-set", fullSetQuery);
  },
};
