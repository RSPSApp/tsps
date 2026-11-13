/**
 * King's barrage (https://oldschool.runescape.wiki/w/King%27s_barrage), a Leagues VI (Demonic
 * Pacts) echo item from Echo King Black Dragon, its two-bolt attack a Leagues VI character's only: a
 * two-handed crossbow that fires bolts up to dragon (RangedData KINGS_BARRAGE). Speeds and range
 * are the cache's (6 ticks, 9 tiles; 10 on Longrange).
 *
 * Item text: "This crossbow shoots 2 bolts at once, one counting as a crossbow attack, the other as
 * an ice attack which will always freeze your current target in place, this freeze can be toggled
 * on and off via the weapon itself. Deals full damage to the Corporeal Beast" (the Beast's own
 * unit). Wiki: each hitsplat's max hit is halved; the freeze lasts 24 ticks; the ice attack does
 * not regenerate runes; the crossbow "generates both ranged and mage experience". The Echo bosses
 * page: the second hit "can scale with water weaknesses and pacts, if the pact for ice spells to be
 * water spells is taken" (Ranged.LeaguePacts.js answers the `combat:ranged-ice-*` events below).
 * Toggle-Freeze is the cache's own option (inventory and worn); its messages are the Wiki
 * transcript's.
 *
 * Each attack is two PendingHits of this method, rolled one after the other with the usual ranged
 * formulas, each max hit halved (a ranged combat modifier, last: after the gear and pacts):
 * - the bolt: an ordinary crossbow hit, its bolt and its enchanted bolt effects (one bolt is spent
 *   an attack, as the core spends any crossbow's);
 * - the ice bolt: no ammunition and no bolt effect (`combat:bolt-proc-chance` 0), its XP to Magic
 *   in Ranged's place (Longrange: Magic and Defence); when it lands, hit or miss, the target is
 *   frozen for 24 ticks unless the player toggled the freeze off (the ice spells' freeze,
 *   CombatFactory's: its immunity and large-NPC rules apply). `combat:extra-hit` names it part of the bolt's attack, so a
 *   per-attack effect (the crossbow echo pact) acts once.
 * Its projectile is the cache's vfx_kings_barrage_projectile_single, flown as a crossbow bolt, and
 * vfx_kings_barrage_impact plays where it lands (ours).
 *
 * Ours: one bolt spent an attack, the ice bolt being the weapon's own; the ice bolt freezes even
 * when it misses ("always"); its XP follows the bolt's per-damage rates.
 */
const FREEZE_TICKS = 24;
const FREEZE_DISABLED_ATTRIBUTE = "kings-barrage:freeze-disabled";
const FREEZE_ON_TEXT = "The King's barrage will now freeze your targets.";
const FREEZE_OFF_TEXT = "The King's barrage will now no longer freeze your target in place on hit.";
const ICE_PROJECTILE = "vfx_kings_barrage_projectile_single";
const ICE_IMPACT = "vfx_kings_barrage_impact";

let core;
let pluginApi;
let method = null;
let IceHit = null;
/** The barrage hit being rolled ({ player, ice }) while its PendingHit is built: its rolls happen in the constructor. */
let rolling = null;
const iceHits = new WeakSet();

/** Leagues VI (Demonic Pacts) item: its effects are a Leagues VI character's only (LeagueMode's `league:profile`). */
const LEAGUE_VI = 6;
function inLeagueSix(player) {
  const query = { player, league: null };
  pluginApi.emitCustomEvent("league:profile", query);
  return Number(query.league) === LEAGUE_VI;
}

function wieldsBarrage(player) {
  const weapon = player?.getEquipment?.().get?.(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.KINGS_BARRAGE;
}

function freezes(player) {
  return player.getAttribute(FREEZE_DISABLED_ATTRIBUTE) !== true;
}

function roll(player, ice, build) {
  const previous = rolling;
  rolling = { player, ice };
  try {
    return build();
  } finally {
    rolling = previous;
  }
}

const rollingFor = (attacker) => (rolling && rolling.player === attacker ? rolling : null);

/** Both bolts' max hits are halved; the ice bolt's may then count as water (the pacts). */
function modifyMaxHit(attacker, target, maxHit) {
  const current = rollingFor(attacker);
  if (!current) return null;
  const halved = Math.floor(maxHit / 2);
  if (!current.ice) return halved;
  const request = { attacker, target, maxHit: halved, baseMaxHit: halved };
  pluginApi.emitCustomEvent("combat:ranged-ice-max-hit", request);
  return request.maxHit;
}

function modifyAttackRoll(attacker, target, attackRoll) {
  if (!rollingFor(attacker)?.ice) return null;
  const request = { attacker, target, attackRoll, baseAttackRoll: attackRoll };
  pluginApi.emitCustomEvent("combat:ranged-ice-attack-roll", request);
  return request.attackRoll;
}

/** The ice bolt is no bolt: no enchanted bolt effect. */
function boltProcChance(proc) {
  if (rollingFor(proc.player)?.ice) proc.chance = 0;
}

function extraHit(query) {
  if (iceHits.has(query.hit)) query.extra = true;
}

function sendIceProjectile(player, target) {
  const id = core.CacheDefinitions.getSpotanimId(ICE_PROJECTILE);
  const shot = core.WeaponProfiles.ranged(player).projectiles?.[0];
  if (id === null || !shot) return;
  const distance = core.CombatPosition.edgeDistance(player, target);
  const projectile = core.Projectile.createProjectile(player, target, id, shot.delay,
    core.RangedCombatMethod.projectileEnd(shot, distance), shot.startHeight, shot.endHeight);
  if (shot.angle != null) projectile.withAngle(shot.angle);
  if (shot.progress != null) projectile.withProgress(shot.progress);
  projectile.sendProjectile();
}

function iceLanded(hit) {
  const attacker = hit.getAttacker();
  const target = hit.getTarget();
  if (!attacker?.isPlayer?.() || !target || target.getHitpoints() <= 0) return;
  const player = attacker.getAsPlayer();
  const impact = core.CacheDefinitions.getSpotanimId(ICE_IMPACT);
  if (impact !== null) target.performGraphic(new core.Graphic(impact));
  if (freezes(player)) core.CombatFactory.freezeTicks(target, FREEZE_TICKS, null, player, "ice");
  pluginApi.emitCustomEvent("combat:ranged-ice-hit-landed", { attacker: player, target, hit });
}

function createMethod() {
  IceHit = class KingsBarrageIceHit extends core.PendingHit {
    /** Its XP goes to Magic where the bolt's goes to Ranged. */
    getSkills() {
      const ranged = core.Skill.RANGED.getIndex();
      const magic = core.Skill.MAGIC.getIndex();
      return super.getSkills().map((skill) => (skill === ranged ? magic : skill));
    }
  };
  method = new (class KingsBarrageCombatMethod extends core.RangedCombatMethod {
    hits(character, target) {
      if (!character?.isPlayer?.()) return super.hits(character, target);
      const player = character.getAsPlayer();
      const delay = core.RangedCombatMethod.landingDelays(character, target)[0];
      const bolt = roll(player, false, () => new core.PendingHit(character, target, this, delay));
      const ice = roll(player, true, () => new IceHit(character, target, this, delay));
      iceHits.add(ice);
      return [bolt, ice];
    }

    start(character, target) {
      super.start(character, target);
      if (character?.isPlayer?.() && character.getCombat().getAmmunition()) sendIceProjectile(character.getAsPlayer(), target);
    }

    handleAfterHitEffects(hit) {
      if (iceHits.has(hit)) iceLanded(hit);
    }
  })();
}

function resolveMethod(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  const player = attacker.getAsPlayer();
  return wieldsBarrage(player) && inLeagueSix(player) && !player.isSpecialActivated?.() ? method : null;
}

function toggleFreeze({ player }) {
  // The freeze is Leagues VI's, so is its toggle (ours: elsewhere the option does nothing).
  if (!inLeagueSix(player)) return true;
  const disable = freezes(player);
  player.setAttribute(FREEZE_DISABLED_ATTRIBUTE, disable);
  player.sendMessage(disable ? FREEZE_OFF_TEXT : FREEZE_ON_TEXT);
  return true;
}

function initialize(api) {
  core = api.core;
  pluginApi = api;
  createMethod();
}

module.exports = {
  name: "KingsBarrage",
  members: true,
  register(api) {
    initialize(api);
    api.persistAttribute(FREEZE_DISABLED_ATTRIBUTE, false);
    api.registerCombatMethodResolver({ resolve: resolveMethod });
    api.registerRangedCombatModifier({ modifyMaxHit, modifyAttackRoll });
    api.onCustomEvent("combat:bolt-proc-chance", boltProcChance);
    api.onCustomEvent("combat:extra-hit", extraHit);
    api.onItemAction("King's barrage", { "Toggle-Freeze": toggleFreeze });
  },
  _test: { resolveMethod, toggleFreeze, modifyMaxHit, modifyAttackRoll, boltProcChance, extraHit, isIceHit: (hit) => iceHits.has(hit), FREEZE_TICKS, FREEZE_DISABLED_ATTRIBUTE },
};
