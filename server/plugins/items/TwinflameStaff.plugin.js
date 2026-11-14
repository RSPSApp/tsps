/**
 * The Twinflame staff (Wiki: Twinflame staff). Its other passives live in the shared systems: the
 * fire and water runes in ElementalStaves.plugin.js, the 10% standard-spellbook Magic accuracy and
 * damage in SmokeStaves.EquipmentEffects.js.
 *
 * - Speed: an attack and cast speed of 6. A spell's own speed (5) becomes 6; a speed something
 *   else has already brought below that (the Royal Titans' 1-tick wall clears) is left alone.
 * - Weakness: autocasting a standard elemental spell (Strike to Surge) at an NPC weak to another
 *   element casts that element's spell of the same tier instead, when the player has its Magic
 *   level and runes (Wiki: level 75 Wind Wave at a moss giant casts Fire Wave). A hand cast is
 *   cast as chosen. Content can name a weakness the NPC's definition lacks through
 *   `twinflame:weakness` { attacker, target, element } (the Royal Titans' walls).
 * - Second spell: each standard elemental cast fires a second spell, 40% of the first's damage
 *   a tick later, with no XP, runes or tome charges (SecondSpell.ElementalSpells.js).
 */
const ElementalSpells = require("../combat/elementalspells/Common.ElementalSpells");
const SecondSpell = require("../combat/elementalspells/SecondSpell.ElementalSpells");

const CAST_SPEED = 6;
/** A standard combat spell's cast speed: the speed the staff replaces. */
const SPELL_SPEED = 5;
const ELEMENTS = ["WIND", "WATER", "EARTH", "FIRE"];

let core;
let pluginApi;
/** player -> the spell the staff swapped in for their autocast spell this attack. */
const swaps = new WeakMap();

function staffIds() {
  const ids = core.ItemIdentifiers;
  return [ids.TWINFLAME_STAFF, ids.TWINFLAME_STAFF_2, ids.TWINFLAME_STAFF_3].filter(Number.isInteger);
}

function wieldsStaff(mobile) {
  if (!mobile?.isPlayer?.()) return false;
  const weapon = mobile.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  return staffIds().includes(weapon?.getId?.() ?? -1);
}

/** Casts with the staff take 6 ticks, unless something has already made this one quicker. */
function attackSpeed(event) {
  if (event.combatType !== core.CombatType.MAGIC || !wieldsStaff(event.attacker)) return;
  if (event.speed >= SPELL_SPEED) event.speed = CAST_SPEED;
}

/** The element (1 wind .. 4 fire) `target` is weak to, or 0. */
function weakElement(attacker, target, spell) {
  const request = { attacker, target, element: 0 };
  pluginApi.emitCustomEvent("twinflame:weakness", request);
  if (request.element) return request.element;
  return ElementalSpells.targetWeakness(attacker, target, spell)?.type ?? 0;
}

/** Whether the player has `spell`'s Magic level and runes (staves, tomes and rune pouches counted). */
function canCast(player, spell) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) < spell.levelRequired()) return false;
  const needed = spell.itemsToConsume(player, spell.itemsRequired(player) ?? []);
  const short = spell.constructor.inventoryShortfall(player, needed);
  return short.length === 0 || core.PluginManager.checkSpellRuneSource(player, short) === true;
}

/** The same-tier spell of `element` for an elemental autocast spell, or null. */
function spellFor(spell, element) {
  const entry = ElementalSpells.metadata(spell);
  if (!entry || !(element >= 1 && element <= 4)) return null;
  return core.CombatSpells[`${ELEMENTS[element - 1]}_${entry.family}`] ?? null;
}

/**
 * Asked as an attack begins, before its permission, speed and cast: an autocast elemental spell
 * aimed at a target weak to another element is swapped for that element's spell this attack.
 */
function swapForWeakness(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target) return;
  const player = attacker.getAsPlayer();
  const combat = player.getCombat();
  // Undo the last attack's swap first: the autocast spell decides afresh every attack.
  const swapped = swaps.get(player);
  if (swapped) {
    swaps.delete(player);
    if (combat.getCastSpell() === swapped) combat.setCastSpell(null);
  }
  if (!wieldsStaff(player) || combat.getCastSpell() != null) return;
  const autocast = combat.getAutocastSpell();
  if (!SecondSpell.isStandardElemental(autocast)) return;
  const own = ElementalSpells.metadata(autocast).element;
  const weak = weakElement(player, target, autocast);
  if (!weak || weak === own) return;
  const replacement = spellFor(autocast, weak);
  if (!replacement || !canCast(player, replacement)) return;
  combat.setCastSpell(replacement);
  swaps.set(player, replacement);
}

module.exports = {
  name: "TwinflameStaff",
  description: "Twinflame staff: casts at speed 6, autocasts the spell of the target's elemental weakness instead, and fires a second spell for 40% of each elemental spell's damage.",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onAttackSpeed(attackSpeed);
    api.onAttackTiming(swapForWeakness);
    SecondSpell.register(api, wieldsStaff);
  },
  _test: { attackSpeed, swapForWeakness, spellFor, weakElement, wieldsStaff },
};
