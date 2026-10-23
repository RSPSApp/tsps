/**
 * Chinchompas (https://oldschool.runescape.wiki/w/Chinchompa_(weapon)).
 *
 * A thrown chinchompa explodes on impact: when the first target's accuracy roll succeeds, every
 * other opponent in the 3x3 around it is hit too (multicombat only). Accuracy depends on the fuse
 * and the distance thrown: short fuse is best within 3 tiles, medium at 4-6, long from 7. Every
 * throw uses up one chinchompa, which cannot be picked up again and is not saved by an Ava's device.
 */
const BLAST_RADIUS = 1;
/** Wiki accuracy of the ranged attack roll by distance band (0-3, 4-6, 7+ tiles). */
const FUSE_ACCURACY = {
  SHORT: [100, 75, 50],
  MEDIUM: [75, 100, 75],
  LONG: [50, 75, 100],
};
/** Child ids of the CHINCHOMPA_SHORT/MEDIUM/LONG_FUSE fight types in item-combat-styles.json. */
const FUSE_BY_CHILD_ID = { 0: "SHORT", 1: "MEDIUM", 3: "LONG" };

let core;
const CHINCHOMPAS = ["CHINCHOMPA_2", "RED_CHINCHOMPA_2", "BLACK_CHINCHOMPA"];
let method;

function wieldedChinchompa(player) {
  const weapon = player?.getEquipment?.()?.get?.(core.Equipment.WEAPON_SLOT);
  return weapon && CHINCHOMPAS.some((name) => core.ItemIdentifiers[name] === weapon.getId()) ? weapon : null;
}

function nearbyMobiles(player) {
  return [...player.getLocalNpcs().values(), ...player.getLocalPlayers().values()];
}

function createMethod() {
  const { CombatFactory, PendingHit, RangedCombatMethod } = core;
  return new (class ChinchompaCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const hits = super.hits(character, target);
      const first = hits[0];
      if (!first?.isAccurate() || !CombatFactory.multiCombatBetween(character, target)) {
        return hits;
      }
      for (const candidate of nearbyMobiles(character.getAsPlayer())) {
        if (CombatFactory.canAttackSecondaryTarget(character, target, candidate, BLAST_RADIUS)) {
          // The first target's roll decides the blast (Wiki), so the rest are not rolled again.
          hits.push(new PendingHit(character, candidate, this, { delay: first.getDelay(), rollAccuracy: false }));
        }
      }
      return hits;
    }
  })();
}

function resolveChinchompa(attacker) {
  if (!attacker?.isPlayer?.() || !wieldedChinchompa(attacker.getAsPlayer())) {
    return null;
  }
  method ??= createMethod();
  return method;
}

function fuseAccuracy(attacker, target, attackRoll) {
  if (!attacker?.isPlayer?.() || !wieldedChinchompa(attacker.getAsPlayer())) {
    return null;
  }
  const fuse = FUSE_BY_CHILD_ID[attacker.getAsPlayer().getFightType().getChildId()];
  const distance = attacker.getLocation().getDistance(target.getLocation());
  const band = distance <= 3 ? 0 : distance <= 6 ? 1 : 2;
  return fuse ? Math.floor((attackRoll * FUSE_ACCURACY[fuse][band]) / 100) : null;
}

/** One chinchompa per throw, gone for good: no floor drop, no Ava's recovery. */
function consumeChinchompa(player, pos, amount, delayTicks = 0) {
  const { Equipment, Flag, Item, Task, TaskManager, WeaponInterfaceManager } = core;
  const weapon = wieldedChinchompa(player);
  if (!weapon) {
    return false;
  }
  const apply = () => {
    // A swap mid-flight moved this stack out of the slot; leave the new one alone.
    if (player.getEquipment().get(Equipment.WEAPON_SLOT) !== weapon) {
      return;
    }
    weapon.decrementAmountBy(amount);
    if (weapon.getAmount() <= 0) {
      player.sendMessage("You have run out of ammunition!");
      player.getEquipment().set(Equipment.WEAPON_SLOT, new Item(-1));
      WeaponInterfaceManager.assign(player);
      player.getUpdateFlag().flag(Flag.APPEARANCE);
    }
    player.getEquipment().refreshItems();
  };
  if (delayTicks > 0) {
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(delayTicks);
      }

      execute() {
        apply();
        this.stop();
      }
    })());
  } else {
    apply();
  }
  return true;
}

module.exports = {
  name: "Chinchompas",
  members: true,
  register(api) {
    core = api.core;
    api.registerCombatMethodResolver({ resolve: resolveChinchompa });
    api.registerRangedCombatModifier({ modifyMaxHit: () => null, modifyAttackRoll: fuseAccuracy });
    api.registerRangedAmmoHandler({ checkAmmo: () => null, decrementAmmo: consumeChinchompa });
  },
};
