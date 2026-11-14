/**
 * Fang of the hound (https://oldschool.runescape.wiki/w/Fang_of_the_hound), a Leagues VI (Demonic
 * Pacts) echo weapon whose effects are a Leagues VI character's only. A dagger: its swing is the
 * cache's human_karambit_attack (which carries its own sound), on every world; its speed (3 ticks)
 * and styles are the cache's stab sword set. Inspect (worn) plays human_karambit_inspect, the
 * weapon spun in the hand. Every hit has a 5% chance to cast
 * Flames of Cerberus at the target, a fire spell with a base max hit of 10 raised by elemental
 * weakness and magic strength, dealt without a second accuracy check, and benefiting from the
 * pacts. Ferocity (its special, specials/FangOfTheHound.SpecialAttack.js) casts it whenever it hits.
 *
 * - The cast is a magic PendingHit of its own (no special's traits), landing with the melee hit
 *   that made it: magic damage bonuses, magic hit modifiers and the pacts' magic damage effects
 *   reach it as they reach any magic hit. A fire weakness (the shared `elemental-spells:weakness`, so
 *   gear that changes it counts) adds its percentage of the base max hit, rounded down, as
 *   Weakness.ElementalSpells.js does for the fire spells it knows by spellbook id.
 * - Ours: "every hit" read as every melee hit with the fang that passes its accuracy roll (the
 *   special's "if it hits"), rolled when the hit is queued; a hit is the fang's when it was rolled
 *   with the fang wielded. The cast's hitsplat earns the usual Hitpoints XP only.
 * - Ours: the graphic, the cache's vfx_flames_of_cerberus for the target's size (1x1 to 5x5).
 */
const ElementalSpells = require("../combat/elementalspells/Common.ElementalSpells");

let core;
let pluginApi;
/** Melee hits rolled with the fang -> { special }: whether Ferocity made them. */
const fangHits = new WeakMap();
let flamesSpell = null;
let flamesMethod = null;

const CHANCE = 0.05;
const BASE_MAX_HIT = 10;
/** NPC elemental weakness type of fire (wind 1, water 2, earth 3, fire 4). */
const FIRE_WEAKNESS = 4;
const SPECIAL_ID = "fang_of_the_hound";
const ATTACK_SEQUENCE = "human_karambit_attack";
const INSPECT_SEQUENCE = "human_karambit_inspect";
/** vfx_flames_of_cerberus_1x1; the 2x2..5x5 versions follow it. */
const FLAMES_GRAPHIC_1X1 = 3742;
const FLAMES_GRAPHIC_LARGEST = 5;

/** Leagues VI (Demonic Pacts) item: its effects are a Leagues VI character's only (LeagueMode's `league:profile`). */
const LEAGUE_VI = 6;
function inLeagueSix(player) {
  const query = { player, league: null };
  pluginApi.emitCustomEvent("league:profile", query);
  return Number(query.league) === LEAGUE_VI;
}

function wieldingFang(player) {
  const { Equipment, ItemIdentifiers } = core;
  return player.getEquipment().get(Equipment.WEAPON_SLOT).getId() === ItemIdentifiers.FANG_OF_THE_HOUND;
}

function flamesGraphic(target) {
  const size = Math.max(1, Math.min(FLAMES_GRAPHIC_LARGEST, Number(target.getSize?.()) || 1));
  return new core.Graphic(FLAMES_GRAPHIC_1X1 + size - 1);
}

function spell() {
  const { Animation, CombatNormalSpell, ItemIdentifiers } = core;
  flamesSpell ??= new CombatNormalSpell({
    // No spellbook id: the weapon's own, as other built-in spells use theirs.
    spellId: () => ItemIdentifiers.FANG_OF_THE_HOUND,
    maximumHit: () => BASE_MAX_HIT,
    castAnimation: () => Animation.DEFAULT_RESET_ANIMATION,
    startGraphic: () => undefined,
    castProjectile: () => undefined,
    endGraphic: () => undefined,
    baseExperience: () => 0,
  });
  // A fire spell to the element pacts (Magic.LeaguePacts elementOf): the Wiki says it benefits from pacts.
  flamesSpell.pactElement = "fire";
  return flamesSpell;
}

function method() {
  const { CombatMethod, CombatType } = core;
  flamesMethod ??= new (class FlamesOfCerberusCombatMethod extends CombatMethod {
    type() { return CombatType.MAGIC; }
    hits() { return null; }
    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (target.getHitpoints() > 0) target.performGraphic(flamesGraphic(target));
    }
  })();
  return flamesMethod;
}

/** Whether `player` is a Flames of Cerberus cast's caster for a magic max-hit request. */
function isFlames(request) {
  return request?.spell === flamesSpell && flamesSpell !== null;
}

/** The target's fire weakness against this attacker: the shared weakness, so an effect that changes it counts. */
function fireWeakness(attacker, target) {
  return Math.max(0, ElementalSpells.elementWeakness(attacker, target, spell(), FIRE_WEAKNESS));
}

/** A fire weakness: its percentage of the base max hit, rounded down. */
function weakness(request) {
  if (!isFlames(request) || !request.attacker?.isPlayer?.() || !request.target?.isNpc?.()) return;
  const percent = fireWeakness(request.attacker, request.target);
  if (percent > 0) request.maxHit += Math.floor((request.baseMaxHit * percent) / 100);
}

/** Builds the cast as a magic hit of the player's, read with the Flames as the selected spell. */
function flamesHit(player, target, delay) {
  const combat = player.getCombat();
  const previous = combat.getCastSpell();
  combat.setCastSpell(spell());
  try {
    return new core.PendingHit(player, target, method(), { delay, rollAccuracy: false, ordinary: true }).setSpell(spell());
  } finally {
    combat.setCastSpell(previous);
  }
}

function castFlames(player, target, delay) {
  if (target.getHitpoints() <= 0) return;
  core.CombatFactory.addPendingHit(flamesHit(player, target, delay));
}

/** A melee hitsplat rolled with the fang: remembered, with whether Ferocity rolled it. */
function hitDamage({ attacker, combatType, hit }) {
  if (combatType !== core.CombatType.MELEE || !attacker?.isPlayer?.() || !hit || fangHits.has(hit)) return;
  const player = attacker.getAsPlayer();
  if (!wieldingFang(player) || !inLeagueSix(player)) return;
  const special = player.isSpecialActivated() && player.getCombatSpecial?.()?.getId?.() === SPECIAL_ID;
  fangHits.set(hit, { special });
}

/** The fang's hit queued: an accurate one casts the Flames, 5% of the time or always with Ferocity. */
function dealt({ player, target, hit }) {
  const rolled = fangHits.get(hit);
  if (!rolled || !target) return;
  fangHits.delete(hit);
  if (!hit.isAccurate()) return;
  if (!rolled.special && Math.random() >= CHANCE) return;
  castFlames(player, target, hit.getDelay());
}

function inspect({ player }) {
  const animation = core.CacheDefinitions.getSeqId(INSPECT_SEQUENCE);
  if (animation !== null) player.performAnimation(new core.Animation(animation));
  return true;
}

function registerProfile(api) {
  const attackAnimation = core.CacheDefinitions.getSeqId(ATTACK_SEQUENCE);
  if (attackAnimation === null) return;
  // The swing's sound is in the animation, so the style's own is not sent.
  api.registerWeaponProfile({ itemIds: [core.ItemIdentifiers.FANG_OF_THE_HOUND], attackAnimation, attackSound: null });
}

function initialize(api) {
  core = api.core;
  pluginApi = api;
  registerProfile(api);
}

module.exports = {
  name: "FangOfTheHound",
  members: true,
  register(api) {
    initialize(api);
    api.onCombatHitDamage(hitDamage);
    api.onPlayerDealtDamage(dealt);
    api.onCustomEvent("combat:magic-max-hit", weakness);
    api.onItemAction("Fang of the hound", { Inspect: inspect });
  },
  _test: { inspect, flamesHit, weakness, hitDamage, dealt, spell, method, flamesGraphic, BASE_MAX_HIT },
};
