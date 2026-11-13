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
let pluginApi;
const CHINCHOMPAS = ["CHINCHOMPA_2", "RED_CHINCHOMPA_2", "BLACK_CHINCHOMPA"];
let method;
/** Players whose swing is between start() and finished(): their throw is paid once it is rolled. */
const swinging = new WeakSet();
/** The throw a swing fired, paid in finished(). */
const pendingThrows = new WeakMap();

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
    start(character, target) {
      const player = character.getAsPlayer();
      payPendingThrow(player);
      swinging.add(player);
      super.start(character, target);
    }

    finished(character, target) {
      super.finished(character, target);
      const player = character.getAsPlayer();
      swinging.delete(player);
      payPendingThrow(player);
    }

    onCombatEnded(character, target) {
      // A swing stopped before finished() (no hits) still threw its chinchompa.
      const player = character.getAsPlayer();
      swinging.delete(player);
      payPendingThrow(player);
      super.onCombatEnded(character, target);
    }

    hits(character, target) {
      const hits = super.hits(character, target);
      const first = hits[0];
      if (!first?.isAccurate() || !CombatFactory.areaAttackSpreads(character, target)) {
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
  const distance = core.CombatPosition.distance(attacker, target);
  const band = distance <= 3 ? 0 : distance <= 6 ? 1 : 2;
  return fuse ? Math.floor((attackRoll * FUSE_ACCURACY[fuse][band]) / 100) : null;
}

function payPendingThrow(player) {
  const pay = pendingThrows.get(player);
  if (!pay) return;
  pendingThrows.delete(player);
  pay();
}

/**
 * One chinchompa per throw, gone for good: no floor drop, no Ava's recovery. Paid on the throw's tick, as worn ammo
 * is (rsprox_transcripts/237/01156.txt), so moving the stack mid-flight (unwield, bank, drop, trade) cannot make the
 * throw free. During a swing it waits for finished(): the throw is rolled with the chinchompa still in the hand (its
 * hit delay, fuse accuracy, ranged bonuses and blast). Nothing is left to do on landing.
 */
function consumeChinchompa(player, _pos, amount) {
  const weapon = wieldedChinchompa(player);
  if (!weapon) {
    return false;
  }
  // Content may keep some throws from costing a chinchompa (a league relic), as core asks for quiver ammunition.
  // `extra`: throws given back on top (Demonic Pacts' Regenerate above 100%), added to the same stack.
  const saving = { player, itemId: weapon.getId(), amount, saved: 0, extra: 0 };
  pluginApi.emitCustomEvent("ranged:ammo-saving", saving);
  const thrown = amount - Math.min(amount, Math.max(0, saving.saved | 0));
  const extra = Math.max(0, saving.extra | 0);
  if (thrown <= 0 && extra <= 0) {
    return true;
  }
  const pay = () => payThrow(player, weapon, thrown, extra);
  if (swinging.has(player)) pendingThrows.set(player, pay);
  else pay();
  return true;
}

function payThrow(player, weapon, thrown, extra) {
  const { Equipment, Flag, Item, WeaponInterfaceManager } = core;
  if (thrown > 0) weapon.decrementAmountBy(thrown);
  if (extra > 0) weapon.incrementAmountBy(extra);
  // The hand is cleared only if it still holds this stack (a throw paid late, after a swing with no hits).
  if (weapon.getAmount() <= 0 && player.getEquipment().get(Equipment.WEAPON_SLOT) === weapon) {
    player.sendMessage("You have run out of ammunition!");
    player.getEquipment().set(Equipment.WEAPON_SLOT, new Item(-1));
    WeaponInterfaceManager.assign(player);
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  }
  player.getEquipment().refreshItems();
}

module.exports = {
  name: "Chinchompas",
  description: "Chinchompa weapons: fuse-based accuracy by distance, area explosion hitting nearby targets in multicombat, and one chinchompa used per throw.",
  _test: { consumeChinchompa },
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    api.registerCombatMethodResolver({ resolve: resolveChinchompa });
    api.registerRangedCombatModifier({ modifyMaxHit: () => null, modifyAttackRoll: fuseAccuracy });
    api.registerRangedAmmoHandler({ checkAmmo: () => null, decrementAmmo: consumeChinchompa });
  },
};
