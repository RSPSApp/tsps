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
 * The shot, on every world: the ballista's swing (the item's stance is the ballista's), and one
 * vfx_kings_barrage_projectile carrying both bolts, landing with them. On a Leagues VI character
 * the target shows vfx_kings_barrage_impact, then ice_burst_impact a moment later, with the impact
 * sound, as the shot lands.
 *
 * Ours: one bolt spent an attack, the ice bolt being the weapon's own; the ice bolt freezes even
 * when it misses ("always"); its XP follows the bolt's per-damage rates.
 */
const FREEZE_TICKS = 24;
const FREEZE_DISABLED_ATTRIBUTE = "kings-barrage:freeze-disabled";
const FREEZE_ON_TEXT = "The King's barrage will now freeze your targets.";
const FREEZE_OFF_TEXT = "The King's barrage will now no longer freeze your target in place on hit.";
const ATTACK_SEQUENCE = "ballista_attack";
const NPC_ATTACK_SEQUENCE = "ballista_attack_pvn";
const PROJECTILE = "vfx_kings_barrage_projectile";
/** Heights in quarter-tiles (sent times four); it ends with its hits, whatever the distance. */
const SHOT = { delay: 41, startHeight: 36.25, endHeight: 31, angle: 5, progress: 70, landingOffset: 15 };
const IMPACT = "vfx_kings_barrage_impact";
const ICE_IMPACT = "ice_burst_impact";
/** The impact spotanims' slots, so both show; the ice one follows 10 client cycles later. */
const IMPACT_SLOT = 1;
const ICE_IMPACT_SLOT = 5;
const ICE_IMPACT_LAG = 10;
const IMPACT_SOUND = 170;
const IMPACT_SOUND_RADIUS = 10;

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

/** The ice burst on the target as the shot lands (client cycles after this tick): two spotanims and the sound. */
function sendImpact(player, target) {
  const { CacheDefinitions, CombatPosition, Graphic, RangedCombatMethod, Sounds } = core;
  const landing = RangedCombatMethod.landingDelays(player, target)[0];
  const end = RangedCombatMethod.projectileEnd(SHOT, CombatPosition.edgeDistance(player, target), landing);
  const impact = CacheDefinitions.getSpotanimId(IMPACT);
  const ice = CacheDefinitions.getSpotanimId(ICE_IMPACT);
  if (impact !== null) target.performGraphicInSlot(IMPACT_SLOT, new Graphic(impact).withDelay(end));
  if (ice !== null) target.performGraphicInSlot(ICE_IMPACT_SLOT, new Graphic(ice).withDelay(end + ICE_IMPACT_LAG));
  const location = target.getLocation();
  Sounds.playAreaSound({
    soundId: IMPACT_SOUND, x: location.getX(), y: location.getY(), level: location.getZ(),
    delay: end, radius: IMPACT_SOUND_RADIUS, source: player,
  });
}

function iceLanded(hit) {
  const attacker = hit.getAttacker();
  const target = hit.getTarget();
  if (!attacker?.isPlayer?.() || !target || target.getHitpoints() <= 0) return;
  const player = attacker.getAsPlayer();
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
      if (character?.isPlayer?.() && character.getCombat().getAmmunition()) sendImpact(character.getAsPlayer(), target);
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

/** The shot's look: the item's own on every world (the two bolts are Leagues VI's). */
function registerProfile(api) {
  const { CacheDefinitions, ItemIdentifiers } = core;
  const attackAnimation = CacheDefinitions.getSeqId(ATTACK_SEQUENCE);
  const npcAttackAnimation = CacheDefinitions.getSeqId(NPC_ATTACK_SEQUENCE);
  const projectileId = CacheDefinitions.getSpotanimId(PROJECTILE);
  api.registerWeaponProfile({
    itemIds: [ItemIdentifiers.KINGS_BARRAGE],
    ...(attackAnimation !== null ? { attackAnimation } : {}),
    ...(npcAttackAnimation !== null ? { npcAttackAnimation } : {}),
    ...(projectileId !== null ? { projectileId, projectiles: [SHOT] } : {}),
  });
}

function initialize(api) {
  core = api.core;
  pluginApi = api;
  createMethod();
  registerProfile(api);
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
  _test: { resolveMethod, sendImpact, SHOT, toggleFreeze, modifyMaxHit, modifyAttackRoll, boltProcChance, extraHit, isIceHit: (hit) => iceHits.has(hit), FREEZE_TICKS, FREEZE_DISABLED_ATTRIBUTE },
};
