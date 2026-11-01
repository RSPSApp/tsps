/**
 * The dream's potions and Dominic's barrels (Wiki: Absorption, Overload (Nightmare Zone); the
 * barrels' Check line recorded in rsprox 234/03279; nightmare-zone.json `potions`):
 * - drunk only in a dream; each dose leaves the next (the last leaves nothing);
 * - absorption: +50 a dose, up to 1,000 (varbit nzone_absorb_potion_effects), taken off the
 *   damage monsters deal before it reaches Hitpoints; not self-inflicted damage nor poison; gone
 *   when the dream ends;
 * - overload: not under 51 Hitpoints; Attack, Strength, Defence, Ranged and Magic to
 *   floor(level * 15/100) + 5 above their base, again every 15 seconds for 5 minutes (varbit
 *   nzone_overload_potion_effects counts the 20 steps down); 50 damage of its own in 5 hits of 10,
 *   which absorption doesn't take; 50 Hitpoints back as it ends;
 * - super ranging and super magic: floor(level * 15/100) + 5, once;
 * - barrels (varbits nzone_potion_1-4, up to 255 doses each): Check, Take (doses into potions),
 *   Store (every dose of that potion carried).
 * Leaving a dream resets every combat stat to normal (Wiki).
 * Not recorded: every line here but the empty barrel's, and the overload's hit timing.
 */
const Common = require("./Common.NightmareZone");

const ABSORB_ATTRIBUTE = "nightmare-zone:absorb";
const OVERLOAD_ATTRIBUTE = "nightmare-zone:overload";
const VIAL_LESS = -1;
const COMBAT_SKILLS = ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC"];

/** Who is overloaded: their steps left and the task's guard. */
const overloads = new Map();

const potions = () => Common.data.potions;
/** The potions themselves (the block also holds the drinking animation and the barrels' cap). */
const kinds = () => Object.entries(potions()).filter(([, potion]) => Array.isArray(potion?.doses));

function potionOf(itemId) {
  for (const [name, potion] of kinds()) {
    const dose = potion.doses.indexOf(itemId);
    if (dose >= 0) return { name, potion, dose };
  }
  return null;
}

function setVarbit(player, attribute, varbit, value) {
  player.setAttribute(attribute, value);
  Common.varbit(player, varbit, value);
}

const absorbOf = (player) => Number(player.getAttribute(ABSORB_ATTRIBUTE)) || 0;

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(Common.core.Skill[skill]);
}

function maxLevel(player, skill) {
  return player.getSkillManager().getMaxLevel(Common.core.Skill[skill]);
}

function boost(player, skills) {
  for (const skill of skills) {
    const base = maxLevel(player, skill);
    const boosted = base + Math.floor((base * 15) / 100) + 5;
    if (level(player, skill) < boosted) player.getSkillManager().setCurrentLevel(Common.core.Skill[skill], boosted, true);
  }
}

// ---------------------------------------------------------------- drinking

function drink({ player, itemId }) {
  const found = potionOf(itemId);
  if (!found) return false;
  if (!Common.dreamOf(player)) {
    player.sendMessage(Common.message("onlyInDream"));
    return true;
  }
  if (found.name === "overload" && player.getHitpoints() < potions().overload.minimumHitpoints) {
    player.sendMessage(Common.message("overloadLowHp", { hp: potions().overload.minimumHitpoints }));
    return true;
  }
  if (found.name === "overload" && overloads.has(player)) {
    player.sendMessage(Common.message("overloadActive"));
    return true;
  }
  const inventory = player.getInventory();
  inventory.delete(itemId, 1);
  const next = found.potion.doses[found.dose + 1] ?? VIAL_LESS;
  if (next > 0) inventory.add(new Common.core.Item(next, 1));
  inventory.refreshItems?.();
  player.performAnimation?.(new Common.core.Animation(potions().drinkAnimation));
  if (found.name === "absorption") drinkAbsorption(player);
  else if (found.name === "overload") drinkOverload(player);
  else boost(player, [found.potion.skill]);
  return true;
}

function drinkAbsorption(player) {
  const { perDose, cap } = potions().absorption;
  setVarbit(player, ABSORB_ATTRIBUTE, "nzone_absorb_potion_effects", Math.min(cap, absorbOf(player) + perDose));
}

/** 50 damage of its own (5 hits of 10, 2 ticks apart: inferred), boosts every 15 s for 5 min. */
function drinkOverload(player) {
  const { hits, damage, hitEvery, steps, stepTicks } = potions().overload;
  const state = { steps };
  overloads.set(player, state);
  setVarbit(player, OVERLOAD_ATTRIBUTE, "nzone_overload_potion_effects", steps);
  boost(player, COMBAT_SKILLS);
  for (let i = 0; i < hits; i++) {
    Common.later(1 + i * hitEvery, () => {
      if (overloads.get(player) !== state || player.getHitpoints() <= 0) return;
      player.getCombat().getHitQueue().addPendingDamage([new Common.core.HitDamage(damage, Common.core.HitMask.RED)]);
    });
  }
  let ticks = 0;
  Common.every(() => {
    if (overloads.get(player) !== state) return false;
    if (++ticks % stepTicks !== 0) return true;
    state.steps--;
    setVarbit(player, OVERLOAD_ATTRIBUTE, "nzone_overload_potion_effects", state.steps);
    if (state.steps <= 0) {
      endOverload(player, true);
      return false;
    }
    boost(player, COMBAT_SKILLS);
    return true;
  });
}

/** The boosts wear off; at its natural end, 50 Hitpoints back (Wiki). */
function endOverload(player, healed) {
  if (!overloads.delete(player)) return;
  setVarbit(player, OVERLOAD_ATTRIBUTE, "nzone_overload_potion_effects", 0);
  resetBoosts(player);
  if (healed) player.heal?.(potions().overload.heal);
  player.sendMessage(Common.message("overloadEnds"));
}

/** Leaving a dream resets every boosted combat stat to its base (Wiki: "resets all stats to normal"). */
function resetBoosts(player) {
  for (const skill of COMBAT_SKILLS) {
    const base = maxLevel(player, skill);
    if (level(player, skill) > base) player.getSkillManager().setCurrentLevel(Common.core.Skill[skill], base, true);
  }
}

/** Leaving a dream resets every combat stat to normal, boosts and drains alike (Wiki). */
function resetAllStats(player) {
  for (const skill of COMBAT_SKILLS) {
    const base = maxLevel(player, skill);
    if (level(player, skill) !== base) player.getSkillManager().setCurrentLevel(Common.core.Skill[skill], base, true);
  }
}

/** Absorption takes monsters' damage first (not the player's own, which never comes this way). */
function absorb({ player, hit }) {
  if (!Common.dreamOf(player)) return;
  const points = absorbOf(player);
  const damage = hit.getTotalDamage();
  if (points <= 0 || damage <= 0 || !hit.getAttacker?.()?.isNpc?.()) return;
  const taken = Math.min(points, damage);
  hit.setTotalDamage(damage - taken);
  setVarbit(player, ABSORB_ATTRIBUTE, "nzone_absorb_potion_effects", points - taken);
}

/** A dream's end: absorption is gone, an overload stops and every boost is back to base (Wiki). */
function dreamEnded(player) {
  setVarbit(player, ABSORB_ATTRIBUTE, "nzone_absorb_potion_effects", 0);
  endOverload(player, false);
  resetAllStats(player);
}

// ---------------------------------------------------------------- barrels

function barrelOf(object) {
  const name = String(object?.getDefinition?.()?.getName?.() ?? "").replace(/ potion$/, "").toLowerCase();
  const found = kinds().find(([, potion]) => potion.barrelName.toLowerCase() === name);
  return found ? { name: found[0], potion: found[1] } : null;
}

const stored = (player, potion) => Number(player.getAttribute(`nightmare-zone:${potion.varbit}`)) || 0;

function setStored(player, potion, doses) {
  setVarbit(player, `nightmare-zone:${potion.varbit}`, potion.varbit, doses);
}

function check({ player, object }) {
  const barrel = barrelOf(object);
  if (!barrel) return false;
  const doses = stored(player, barrel.potion);
  const text = doses > 0
    ? Common.message("barrelHolds", { potion: barrel.potion.barrelName.toLowerCase(), doses, s: doses === 1 ? "" : "s" })
    : Common.message("barrel", { potion: barrel.potion.barrelName.toLowerCase() });
  Common.talk(player, [["item", text, barrel.potion.doses[0]]]);
  return true;
}

/** Take: doses become full potions where they can, the rest one smaller potion. */
function take({ player, object }) {
  const barrel = barrelOf(object);
  if (!barrel) return false;
  const doses = stored(player, barrel.potion);
  if (doses <= 0) {
    check({ player, object });
    return true;
  }
  player.setEnteredAmountAction?.({
    execute: (amount) => {
      const inventory = player.getInventory();
      let wanted = Math.min(doses, Math.max(0, Math.floor(Number(amount) || 0)));
      let given = 0;
      while (wanted > 0 && inventory.getFreeSlots() > 0) {
        const size = Math.min(4, wanted);
        inventory.add(new Common.core.Item(barrel.potion.doses[4 - size], 1));
        wanted -= size;
        given += size;
      }
      inventory.refreshItems?.();
      setStored(player, barrel.potion, doses - given);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(Common.message("takePrompt", { potion: barrel.potion.barrelName.toLowerCase(), doses }));
  return true;
}

/** Store: every dose of the barrel's potion carried goes in, up to 255. */
function store({ player, object }) {
  const barrel = barrelOf(object);
  if (!barrel) return false;
  const inventory = player.getInventory();
  let doses = stored(player, barrel.potion);
  barrel.potion.doses.forEach((id, index) => {
    const size = 4 - index;
    while (inventory.getAmount(id) > 0 && doses + size <= potions().barrelCap) {
      inventory.delete(id, 1);
      doses += size;
    }
  });
  inventory.refreshItems?.();
  setStored(player, barrel.potion, doses);
  return true;
}

function loggedIn({ player }) {
  for (const [, potion] of kinds()) {
    if (potion.varbit) Common.varbit(player, potion.varbit, stored(player, potion));
  }
  setVarbit(player, ABSORB_ATTRIBUTE, "nzone_absorb_potion_effects", 0);
}

function forget({ player }) {
  overloads.delete(player);
}

function attachPotions(api) {
  for (const [, potion] of kinds()) {
    if (potion.varbit) api.persistAttribute(`nightmare-zone:${potion.varbit}`, 0);
  }
  api.onPlayerLogin(loggedIn);
  api.onPlayerLogout(forget);
  for (const [, potion] of kinds()) {
    for (const id of potion.doses) api.onItemAction(Common.core.CacheDefinitions.getItem(id).name, { Drink: drink });
    if (potion.barrelName) api.onObjectInteraction(`${potion.barrelName} potion`, { Check: check, Take: take, Store: store });
  }
  api.onPlayerHitModify(absorb);
}

module.exports = { attachPotions, drink, absorb, dreamEnded, endOverload, check, take, store, overloads, absorbOf, stored, setStored };
