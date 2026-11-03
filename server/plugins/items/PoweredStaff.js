"use strict";

/**
 * Powered staves (docs/powered-staves.md): staves with a built-in spell that is the only one they
 * cast, whatever is selected or autocast. One charge a cast; an emptied staff becomes its
 * uncharged version. Shared by the staff plugins in this directory; each keeps its own charging,
 * checking and uncharging, which differ from staff to staff.
 *
 * `definePoweredStaff(api, config)`:
 * - `name`: the staff's name in messages; `chargesKey`: the item meta holding its charges;
 *   `maxCharges`.
 * - `pairs`: [[chargedId, unchargedId], ...]. Only these staves attack with the built-in spell.
 * - `maxHit(player)`, `attackSpeed`, `range` (Longrange adds `LONGRANGE_EXTRA`), `levelRequired`.
 * - `spell(core)`: the spell's look - `castAnimation`, `startGraphic`, `castSound` (sound id) and
 *   `castProjectile(cast, castOn)`.
 * - `hitDelay(attacker, target)`: ticks until the hit lands (default: the usual magic delay).
 * - `impact(attacker, target, accurate)`: when set, the impact (or splash) is sent with the cast,
 *   delayed to the projectile's arrival, as live does; return { graphic, areaSound }. Otherwise
 *   `endGraphic` is shown when the hit lands, and a miss splashes, as for spellbook spells.
 * - `landSound`: a sound the caster hears when the hit lands.
 * - `onHitCalc(hit)`, `onHitLanded(hit)`: the staff's own effects (life leech, venom).
 * - `specialId`: while this special is armed the resolver steps aside, so the special's own
 *   method attacks.
 * - `canAttack(player, target)`: false refuses (after sending its own message).
 * - `useChargeAt`: "canAttack" (default) or "start".
 * - `noChargesMessage`, `ranOutMessage`, `chargeUsed(player, staff, left)`, `emptied(player)`.
 * - `methodFlags`: properties copied onto the combat method for other content to read.
 * - `swapWhenEmpty`: false keeps an emptied staff charged (a revenant weapon keeps its deposit).
 */

const LONGRANGE_EXTRA = 2;
/** Live's impact and splash sounds are area sounds this far round the target. */
const IMPACT_SOUND_RANGE = 10;
/** Every built-in staff spell is recognisable by this flag (Surok's powered staff check). */
const POWERED_STAFF_SPELL = "poweredStaffSpell";

function clamp(value, max) {
  return Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
}

function definePoweredStaff(api, config) {
  const core = api.core;
  const unchargedByCharged = new Map(config.pairs);
  const chargedByUncharged = new Map(config.pairs.map(([charged, uncharged]) => [uncharged, charged]));
  const spells = new WeakMap();
  let method = null;

  const weaponOf = (player) => player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] ?? null;
  const isCharged = (id) => unchargedByCharged.has(Number(id));
  const isStaff = (id) => isCharged(id) || chargedByUncharged.has(Number(id));
  const chargesOf = (item) => clamp(item?.getMetaValue?.(config.chargesKey), config.maxCharges);

  function wields(player, chargedOnly = false) {
    const id = weaponOf(player)?.getId?.();
    return chargedOnly ? isCharged(id) : isStaff(id);
  }

  /** Stores charges and swaps between the charged and uncharged staff to match. */
  function setCharges(item, value) {
    const charges = clamp(value, config.maxCharges);
    item.setMetaValue(config.chargesKey, charges > 0 ? charges : undefined);
    const id = item.getId();
    if (charges > 0 && chargedByUncharged.has(id)) item.setId(chargedByUncharged.get(id));
    if (charges <= 0 && unchargedByCharged.has(id) && config.swapWhenEmpty !== false) item.setId(unchargedByCharged.get(id));
    return charges;
  }

  function spellFor(player) {
    let spell = spells.get(player);
    if (spell) return spell;
    const look = config.spell(core);
    spell = new core.CombatNormalSpell({
      spellId: () => config.pairs[0][0],
      maximumHit: () => config.maxHit(player),
      castAnimation: look.castAnimation,
      startGraphic: look.startGraphic ?? (() => null),
      castProjectile: look.castProjectile ?? (() => null),
      // Sent with the cast when the staff times its own impact.
      endGraphic: config.impact ? () => null : (look.endGraphic ?? (() => null)),
      castSound: look.castSound,
      // Powered staves pay only the damage-based experience.
      baseExperience: () => 0,
      levelRequired: () => config.levelRequired ?? 1,
    });
    spell[POWERED_STAFF_SPELL] = true;
    spells.set(player, spell);
    return spell;
  }

  /** Takes a charge; an emptied staff becomes the uncharged one. */
  function useCharge(player) {
    const staff = weaponOf(player);
    if (!staff) return;
    // Content may spare the charge (a league relic): the question every powered staff asks.
    const consume = { player, itemId: staff.getId(), skip: false };
    api.emitCustomEvent("combat:consume-charge", consume);
    if (consume.skip) return;
    const left = setCharges(staff, chargesOf(staff) - 1);
    config.chargeUsed?.(player, staff, left);
    if (left > 0 || config.swapWhenEmpty === false) return;
    player.getEquipment().refreshItems();
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
    config.emptied?.(player);
    if (config.ranOutMessage) player.sendMessage(config.ranOutMessage);
  }

  function sendImpact(attacker, target, accurate) {
    const impact = config.impact(attacker, target, accurate);
    if (impact?.graphic) target.performGraphic(impact.graphic);
    const sound = impact?.areaSound;
    const at = target.getLocation?.();
    if (sound && at) {
      core.Sounds.playAreaSound({
        soundId: sound.id, x: at.getX(), y: at.getY(), level: at.getZ(), delay: sound.delay ?? 0, radius: IMPACT_SOUND_RANGE,
      });
    }
  }

  function buildMethod() {
    const { MagicCombatMethod, PendingHit } = core;
    return new (class extends MagicCombatMethod {
      canAttack(character, target) {
        const player = character.getAsPlayer();
        if (!wields(player, true) || chargesOf(weaponOf(player)) <= 0) {
          player.sendMessage(config.noChargesMessage);
          player.getCombat().reset();
          return false;
        }
        if (config.canAttack && config.canAttack(player, target) === false) {
          player.getCombat().reset();
          return false;
        }
        player.getCombat().setCastSpell(spellFor(player));
        if (config.useChargeAt !== "start") useCharge(player);
        return true;
      }

      start(character, target) {
        if (config.useChargeAt === "start") useCharge(character.getAsPlayer());
        super.start(character, target);
      }

      /** While the staff is worn: an empty one is refused by canAttack, which says why. */
      canPursue(character) {
        return wields(character.getAsPlayer());
      }

      hits(character, target) {
        const spell = spellFor(character.getAsPlayer());
        const delay = config.hitDelay ? config.hitDelay(character, target) : MagicCombatMethod.hitDelay(character, target, spell);
        // The built-in spell is never the staff's special (the resolver steps aside for that).
        const hit = new PendingHit(character, target, this, { delay, ordinary: true }).setSpell(spell);
        spell.onHitCalc(hit);
        config.onHitCalc?.(hit);
        if (config.impact) sendImpact(character, target, hit.isAccurate());
        return [hit];
      }

      handleAfterHitEffects(hit) {
        const attacker = hit.getAttacker();
        if (config.impact) {
          hit.getSpell()?.finishCast(attacker, hit.getTarget(), hit.isAccurate(), hit.getTotalDamage(), hit.getSpellContext());
        } else {
          super.handleAfterHitEffects(hit);
        }
        if (config.landSound && attacker?.isPlayer?.()) {
          core.Sounds.sendSound(attacker, new core.Sound(config.landSound, 1, 0, 0));
        }
        config.onHitLanded?.(hit);
      }

      attackSpeed() {
        return config.attackSpeed;
      }

      attackDistance(character) {
        // Longrange is the powered staff's defensive style.
        const longrange = character.getFightType?.()?.getStyle?.() === core.FightStyle.DEFENSIVE;
        return config.range + (longrange ? LONGRANGE_EXTRA : 0);
      }

      /** Keeps attacking: the staff casts on its own, unlike a single manual cast. */
      finished(character) {
        const combat = character.getCombat();
        combat.setPreviousCast(spellFor(character.getAsPlayer()));
        combat.setCastSpell(null);
      }
    })();
  }

  function getMethod() {
    // Flags other content reads off the method (the Wilderness plugin's warpedSceptreBuiltInSpell).
    return method ?? (method = Object.assign(buildMethod(), config.methodFlags ?? {}));
  }

  function resolve(attacker) {
    if (!attacker?.isPlayer?.()) return null;
    const player = attacker.getAsPlayer();
    if (!wields(player)) return null;
    if (config.specialId && player.isSpecialActivated?.() === true
        && player.getCombatSpecial?.()?.getId?.() === config.specialId) {
      return null;
    }
    return getMethod();
  }

  /**
   * "powered-staff:spell" { player, spell: null }: for the worn staff's special, its built-in
   * spell, `charges`, `useCharge()`, `attackDistance(character)`, `hitDelay(target)` and
   * `sendImpact(target, accurate)` (when the staff times its own impact).
   */
  function answerSpell(request) {
    const player = request?.player;
    if (!player || request.spell != null || !wields(player)) return;
    request.spell = spellFor(player);
    request.charges = chargesOf(weaponOf(player));
    request.useCharge = () => useCharge(player);
    request.attackDistance = (character) => getMethod().attackDistance(character);
    request.hitDelay = (target) => (config.hitDelay
      ? config.hitDelay(player, target)
      : core.MagicCombatMethod.hitDelay(player, target, request.spell));
    request.sendImpact = config.impact ? (target, accurate) => sendImpact(player, target, accurate) : null;
  }

  return {
    resolver: { resolve },
    answerSpell,
    method: getMethod,
    spellFor,
    useCharge,
    chargesOf,
    setCharges,
    weaponOf,
    wields,
    isStaff,
    isCharged,
    chargedByUncharged,
    unchargedByCharged,
  };
}

/** Projectile cycles from the caster's tile to the target's, the distance packets use. */
function distance(from, to) {
  return from.getLocation().getDistance(to.getLocation());
}

/** Ticks until a hit lands with a projectile ending `endCycle` (30 cycles a tick). */
function ticksFor(endCycle) {
  return Math.max(1, Math.ceil(endCycle / 30));
}

/** True for a built-in powered staff spell (from this helper). */
function isPoweredStaffSpell(spell) {
  return spell?.[POWERED_STAFF_SPELL] === true;
}

module.exports = { definePoweredStaff, distance, ticksFor, isPoweredStaffSpell, LONGRANGE_EXTRA, IMPACT_SOUND_RANGE };
