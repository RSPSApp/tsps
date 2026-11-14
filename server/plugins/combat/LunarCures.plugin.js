// OSRS Wiki: Cure Me / Cure Other / Cure Group / Venom (24 October 2026).
// Cures remove poison, downgrade venom at its current damage, and grant no immunity.
const DEFINITIONS = new Map([
  ['cure me', { level: 71, xp: 69, runes: [['ASTRAL_RUNE', 2], ['COSMIC_RUNE', 2], ['LAW_RUNE', 1]] }],
  ['cure other', { level: 68, xp: 65, runes: [['ASTRAL_RUNE', 1], ['EARTH_RUNE', 10], ['LAW_RUNE', 1]] }],
  ['cure group', { level: 74, xp: 74, runes: [['ASTRAL_RUNE', 2], ['COSMIC_RUNE', 2], ['LAW_RUNE', 2]] }],
]);
const POISON_SEVERITY_PER_DAMAGE = 5;
const GROUP_RADIUS = 1;
const TARGET_RANGE = 10;
// Cache: quest_lunar_pushing_magic_animation / quest_lunar_cure_me_spot.
const CURE_ME_ANIMATION = 4411;
const CURE_ME_GRAPHIC = 742;
// Both are at height 92 in rsprox captures (742: 16 casts; 747: the Lunar teleport).
const CAST_GRAPHIC_HEIGHT = 92;
// Uncaptured cure spells keep their existing presentation.
const CAST_ANIMATION = 4413;
const CAST_GRAPHIC = 747;
// rsprox rec 820 (rev 234), 8 Cure Me casts on poison: synth 2884 and this line at the click, with the poison varp to 0.
const CURE_ME_SOUND = 2884;
const POISON_CURED = 'Your poison has been cured.';
// rsprox rec 820 tick 5192: Cure Group with no one poisoned around the caster sends one line per nearby player with
// Accept Aid off, then this one, and casts nothing (no animation, runes or XP).
const NOT_ACCEPTING_AID = name => `That spell cannot be cast on ${name} as they are not accepting aid.`;
const NO_ONE_POISONED = 'No-one around you with Accept Aid on needs their poison healing.';
const spells = new WeakMap();
const lastCureMeCycle = new WeakMap();

function cure(player) {
  // Venom becomes poison of its last hit dealt at the lowest severity giving it, 5 x hit - 4, as an antipoison
  // does (rsprox_transcripts/234/03280.txt:69820: next 12, last 10, becomes 46; 223/00014.txt tick 3125: venom
  // yet to hit converts from its first, 6 becomes 26). Read before setVenomed(false) clears the last hit.
  const lastHit = player.getLastVenomDamage?.() ?? player.getPoisonDamage();
  const severity = player.isVenomed() ? Math.max(0, lastHit * POISON_SEVERITY_PER_DAMAGE - 4) : 0;
  player.setVenomed(false);
  player.setPoisonDamage(severity);
}

function spellFor(core, name) {
  let cache = spells.get(core);
  if (!cache) { cache = new Map(); spells.set(core, cache); }
  if (cache.has(name)) return cache.get(name);
  const data = DEFINITIONS.get(name), widget = core.CacheDefinitions.getSpellByName(name);
  if (!widget) throw new Error(`Missing cache spell: ${name}`);
  class CureSpell extends core.Spell {
    constructor() { super(); this.members = true; }
    spellId() { return widget.widgetId; }
    levelRequired() { return data.level; }
    baseExperience() { return data.xp; }
    itemsRequired() { return data.runes.map(([key, n]) => new core.Item(core.ItemIdentifiers[key], n)); }
    equipmentRequired() { return []; }
    startCast() {}
    getSpellbook() { return core.MagicSpellbook.LUNAR; }
  }
  const spell = new CureSpell(); cache.set(name, spell); return spell;
}

/** Whether the cure has anything to do on `player`: poison or venom. */
function poisoned(player) {
  return player.getPoisonDamage() > 0;
}

/** `ready` runs after the requirements pass and before paying; false refuses the cast at no cost. */
function cast(core, player, name, effect, ready = () => true) {
  const cycle = core.World.getProcessCycle();
  if (name === 'cure me' && lastCureMeCycle.get(player) === cycle) return;
  if (player.getSkillManager().getMaxLevel(core.Skill.DEFENCE) < 40) {
    player.sendMessage('You need at least level 40 Defence to cast Lunar spells.');
    return;
  }
  const spell = spellFor(core, name);
  if (!spell.canCast(player, false) || !ready() || !spell.canCast(player, true)) return;
  if (name === 'cure me') lastCureMeCycle.set(player, cycle);
  player.performAnimation(new core.Animation(name === 'cure me' ? CURE_ME_ANIMATION : CAST_ANIMATION));
  player.performGraphic(new core.Graphic(name === 'cure me' ? CURE_ME_GRAPHIC : CAST_GRAPHIC, 0, CAST_GRAPHIC_HEIGHT));
  if (name === 'cure me') player.getPacketSender().sendSoundEffect(CURE_ME_SOUND, 1, 0, 255);
  effect();
  player.getSkillManager().addExperiences(core.Skill.MAGIC, spell.baseExperience());
}

function acceptsAid(player) {
  return player.getAttribute('accept-aid') !== false;
}

function sameInstance(player, target) {
  return (player.getPrivateArea() ?? null) === (target.getPrivateArea() ?? null);
}

/**
 * A duel is the two duelists' alone, as for the other Lunar aid spells (LunarSpells): no one else's cure reaches a
 * duelist, a duelist's Cure Other reaches no one, and a duelist's Cure Group cures themself and non-duelists only.
 */
function inDuel(player) {
  return player?.getDueling?.()?.inDuel?.() === true;
}

function castSelf(core, event) {
  if (event.handled) return;
  const name = event.spellName?.trim().toLowerCase();
  if (name !== 'cure me' && name !== 'cure group') return;
  if (event.opId != null && event.opId !== 1) return;
  event.handled = true;
  const { player } = event;
  if (name === 'cure me') {
    cast(core, player, name, () => {
      // Ours: the line is recorded for poison only; venom converted to poison, or no poison at all, sends none.
      const wasPoison = poisoned(player) && !player.isVenomed();
      cure(player);
      if (wasPoison) player.sendMessage(POISON_CURED);
    });
    return;
  }
  const around = [];
  core.World.getPlayers().forEach(target => {
    if (target && target.getHitpoints() > 0 && sameInstance(player, target) && (target === player || !inDuel(target)) &&
        player.getLocation().isWithinDistance(target.getLocation(), GROUP_RADIUS)) around.push(target);
  });
  const targets = around.filter(acceptsAid);
  cast(core, player, name, () => targets.forEach(cure), () => {
    if (targets.some(poisoned)) return true;
    // Ours: the refusal is recorded; whether a cast that goes ahead also names the refusing players is not.
    for (const target of around) if (target !== player && !targets.includes(target)) player.sendMessage(NOT_ACCEPTING_AID(target.getDisplayName()));
    player.sendMessage(NO_ONE_POISONED);
    return false;
  });
}

function castOther(core, event) {
  if (event.handled || event.spellName?.trim().toLowerCase() !== 'cure other') return;
  event.handled = true;
  const { player, target } = event;
  if (!target || target === player || !acceptsAid(target) || inDuel(player) || inDuel(target) ||
      !sameInstance(player, target) || target.getHitpoints() <= 0 ||
      !player.getLocation().isWithinDistance(target.getLocation(), TARGET_RANGE)) return;
  cast(core, player, 'cure other', () => cure(target));
}

module.exports = {
  name: 'LunarCures',
  description: 'The Lunar spells Cure Me, Cure Other and Cure Group, which remove poison and weaken venom.',
  members: true,
  register(api) {
    api.onSpellCast(castSelf.bind(null, api.core));
    api.onCustomEvent('magic:spell-on-player', castOther.bind(null, api.core));
  },
};
