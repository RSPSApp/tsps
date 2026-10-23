"use strict";

/**
 * Essence pouches: small, medium, large, giant and colossal.
 *
 * rsprox captures (rev 241, Guardians of the Rift and the index):
 * - A pouch holds one kind of essence at a time. Each pouch's count and kind are varbits
 *   (`<size>_essence_pouch`, `<size>_essence_pouch_type`: 1 rune, 2 pure, 3 daeyalt,
 *   4 guardian), cleared to 0 when it empties.
 * - Fill with the pouch full, or with nothing to fill it with, empties it instead (the
 *   left-click swaps between Fill and Empty, Wiki: 8 January 2025).
 * - Messages: "You do not have any essence to fill your pouch with.", "The pouch contains pure
 *   essence, so you can fill it only with more pure essence.", "There is no essence in this
 *   pouch.", "There are forty guardian essences in this pouch.", "You do not have any free
 *   space in your inventory.", "Your pouch has decayed through use."
 * Wiki: capacities 3/6/9/12; the colossal pouch holds 8/16/27/40 at 25/50/75/85 Runecraft. Pouches
 * decay with essence stored (medium ~270, large ~261, giant ~120, colossal ~320), never while a
 * Runecraft or max cape is worn; a decayed pouch holds 3/7/9/35 until it is repaired.
 *
 * The abyssal needle (Wiki): used on any of the four pouches with all of them, undecayed, in the
 * inventory, it stitches them into a colossal pouch: "You attempt to stitch together all of the
 * pouches.", 1,000 Crafting XP; 56 Crafting and 25 Runecraft, unboosted ("You need level 56 Crafting
 * to even attempt stitching these together."). The capacity line and the refusal for pouches that
 * still hold essence are ours.
 *
 * Other plugins: "runecrafting:remove-guardian-essence" { player } empties guardian essence from
 * every pouch (it can't leave Guardians of the Rift), and "runecrafting:repair-pouches"
 * { player, repaired } repairs every decayed pouch.
 */

const POUCHES_ATTRIBUTE = "runecrafting:pouches";

const ESSENCES = [
  { type: 1, item: "blankrune", name: "rune essence" },
  { type: 2, item: "blankrune_high", name: "pure essence" },
  { type: 3, item: "blankrune_daeyalt", name: "daeyalt essence" },
  { type: 4, item: "gotr_guardian_essence", name: "guardian essence" },
];
const GUARDIAN_ESSENCE_TYPE = 4;

const POUCHES = [
  { key: "small", item: "rcu_pouch_small", level: 1, capacity: 3, varbit: "small_essence_pouch", typeVarbit: "small_essence_pouch_type" },
  {
    key: "medium", item: "rcu_pouch_medium", degraded: "rcu_pouch_medium_degrade", level: 25, capacity: 6,
    varbit: "medium_essence_pouch", typeVarbit: "medium_essence_pouch_type",
    decayVarp: "rcu_pouch_degradation_med", decaysAfter: 270, decayedCapacity: 3,
  },
  {
    key: "large", item: "rcu_pouch_large", degraded: "rcu_pouch_large_degrade", level: 50, capacity: 9,
    varbit: "large_essence_pouch", typeVarbit: "large_essence_pouch_type",
    decayVarp: "rcu_pouch_degradation_large", decaysAfter: 261, decayedCapacity: 7,
  },
  {
    key: "giant", item: "rcu_pouch_giant", degraded: "rcu_pouch_giant_degrade", level: 75, capacity: 12,
    varbit: "giant_essence_pouch", typeVarbit: "giant_essence_pouch_type",
    decayVarp: "rcu_pouch_degradation_giant", decaysAfter: 120, decayedCapacity: 9,
  },
  {
    key: "colossal", item: "rcu_pouch_colossal", degraded: "rcu_pouch_colossal_degrade", level: 25,
    capacityByLevel: [[85, 40], [75, 27], [50, 16], [25, 8]],
    varbit: "colossal_essence_pouch", typeVarbit: "colossal_essence_pouch_type",
    decayVarbit: "rcu_pouch_degradation_colossal", decaysAfter: 320, decayedCapacity: 35,
  },
];

const NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty"];

let core;
let pluginApi;
const ids = new Map();

function objId(name) {
  if (!ids.has(name)) ids.set(name, core.CacheDefinitions.getObjId(name));
  return ids.get(name);
}

function varbitId(name) {
  if (!ids.has(`varbit:${name}`)) ids.set(`varbit:${name}`, core.CacheDefinitions.getVarbitId(name));
  return ids.get(`varbit:${name}`);
}

function varpId(name) {
  if (!ids.has(`varp:${name}`)) ids.set(`varp:${name}`, core.CacheDefinitions.getVarpId(name));
  return ids.get(`varp:${name}`);
}

/** "forty", "twenty-seven": live writes the count out (rsprox: "There are forty guardian essences"). */
function words(count) {
  if (count < 20) return NUMBERS[count];
  const tens = TENS[Math.floor(count / 10)];
  return count % 10 === 0 ? tens : `${tens}-${NUMBERS[count % 10]}`;
}

function pouchFor(itemId) {
  return POUCHES.find((pouch) => objId(pouch.item) === itemId || (pouch.degraded && objId(pouch.degraded) === itemId)) ?? null;
}

function essenceOfType(type) {
  return ESSENCES.find((essence) => essence.type === type) ?? null;
}

function runecraftLevel(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.RUNECRAFTING);
}

function isDegraded(player, pouch) {
  return Boolean(pouch.degraded) && player.getInventory().contains(objId(pouch.degraded))
    && !player.getInventory().contains(objId(pouch.item));
}

function capacity(player, pouch) {
  if (isDegraded(player, pouch)) return pouch.decayedCapacity;
  if (!pouch.capacityByLevel) return pouch.capacity;
  const level = runecraftLevel(player);
  return pouch.capacityByLevel.find(([required]) => level >= required)?.[1] ?? 0;
}

// ------------------------------------------------------------------ state

/**
 * { small: { amount, type, decay }, ... }. Saves from before essence kinds (an array of
 * { pouch: { itemId }, runeEssenceAmt, pureEssenceAmt }) load as rune or pure essence.
 */
function states(player) {
  const raw = player.getAttribute(POUCHES_ATTRIBUTE);
  if (raw && !Array.isArray(raw) && typeof raw === "object") return raw;
  const migrated = {};
  for (const pouch of POUCHES) migrated[pouch.key] = { amount: 0, type: 0, decay: 0 };
  for (const entry of Array.isArray(raw) ? raw : []) {
    const pouch = pouchFor(entry?.pouch?.itemId ?? -1);
    if (!pouch) continue;
    const pure = Math.max(0, Number(entry.pureEssenceAmt) || 0);
    const rune = Math.max(0, Number(entry.runeEssenceAmt) || 0);
    migrated[pouch.key] = pure > 0
      ? { amount: pure, type: 2, decay: 0 }
      : { amount: rune, type: rune > 0 ? 1 : 0, decay: 0 };
  }
  player.setAttribute(POUCHES_ATTRIBUTE, migrated);
  return migrated;
}

function stateOf(player, pouch) {
  const all = states(player);
  if (!all[pouch.key]) all[pouch.key] = { amount: 0, type: 0, decay: 0 };
  return all[pouch.key];
}

function save(player, pouch, state) {
  if (state.amount <= 0) {
    state.amount = 0;
    state.type = 0;
  }
  player.setAttribute(POUCHES_ATTRIBUTE, { ...states(player), [pouch.key]: state });
  sync(player, pouch, state);
}

function sync(player, pouch, state) {
  const sender = player.getPacketSender();
  sender.sendVarbit(varbitId(pouch.varbit), state.amount);
  sender.sendVarbit(varbitId(pouch.typeVarbit), state.type);
  if (pouch.decayVarp) sender.sendConfig(varpId(pouch.decayVarp), state.decay ?? 0);
  if (pouch.decayVarbit) sender.sendVarbit(varbitId(pouch.decayVarbit), Math.min(1023, state.decay ?? 0));
}

// ------------------------------------------------------------------ fill, check, empty

function essenceToFill(player, state) {
  const inventory = player.getInventory();
  if (state.type) {
    const kind = essenceOfType(state.type);
    return inventory.getAmount(objId(kind.item)) > 0 ? kind : null;
  }
  return ESSENCES.find((essence) => inventory.getAmount(objId(essence.item)) > 0) ?? null;
}

function hasAnyEssence(player) {
  return ESSENCES.some((essence) => player.getInventory().getAmount(objId(essence.item)) > 0);
}

function fill(event) {
  const pouch = pouchFor(event.itemId);
  if (!pouch) return false;
  const { player } = event;
  if (runecraftLevel(player) < pouch.level) {
    player.sendMessage(`You need a Runecrafting level of at least ${pouch.level} to use this.`);
    return true;
  }
  const state = stateOf(player, pouch);
  const room = capacity(player, pouch) - state.amount;
  const kind = essenceToFill(player, state);
  if (state.amount > 0 && (room <= 0 || !hasAnyEssence(player))) {
    empty(event);
    return true;
  }
  if (!kind) {
    if (state.type && hasAnyEssence(player)) {
      const held = essenceOfType(state.type).name;
      player.sendMessage(`The pouch contains ${held}, so you can fill it only with more ${held}.`);
    } else {
      player.sendMessage("You do not have any essence to fill your pouch with.");
    }
    return true;
  }
  const inventory = player.getInventory();
  const moved = Math.min(room, inventory.getAmount(objId(kind.item)));
  inventory.delete(objId(kind.item), moved);
  inventory.refreshItems();
  state.amount += moved;
  state.type = kind.type;
  decay(player, pouch, state, moved);
  save(player, pouch, state);
  return true;
}

function check(event) {
  const pouch = pouchFor(event.itemId);
  if (!pouch) return false;
  const state = stateOf(event.player, pouch);
  if (state.amount <= 0) {
    event.player.sendMessage("There is no essence in this pouch.");
    return true;
  }
  const name = essenceOfType(state.type)?.name ?? "essence";
  event.player.sendMessage(state.amount === 1
    ? `There is one ${name} in this pouch.`
    : `There are ${words(state.amount)} ${name}s in this pouch.`);
  return true;
}

function empty(event) {
  const pouch = pouchFor(event.itemId);
  if (!pouch) return false;
  const { player } = event;
  const state = stateOf(player, pouch);
  if (state.amount <= 0) {
    player.sendMessage("There is no essence in this pouch.");
    return true;
  }
  const inventory = player.getInventory();
  const space = inventory.getFreeSlots();
  if (space <= 0) {
    player.sendMessage("You do not have any free space in your inventory.");
    return true;
  }
  const moved = Math.min(space, state.amount);
  inventory.adds(objId(essenceOfType(state.type).item), moved);
  state.amount -= moved;
  save(player, pouch, state);
  return true;
}

// ------------------------------------------------------------------ decay and repair

function wearsRunecraftCape(player) {
  const request = { player, skill: "RUNECRAFTING", result: false };
  pluginApi.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

/** Wiki: pouches decay with the essence stored in them; a worn Runecraft or max cape stops it. */
function decay(player, pouch, state, stored) {
  if (!pouch.degraded || stored <= 0 || wearsRunecraftCape(player) || isDegraded(player, pouch)) return;
  state.decay = (state.decay ?? 0) + stored;
  if (state.decay < pouch.decaysAfter) return;
  const inventory = player.getInventory();
  inventory.delete(objId(pouch.item), 1);
  inventory.adds(objId(pouch.degraded), 1);
  inventory.refreshItems();
  state.amount = Math.min(state.amount, pouch.decayedCapacity);
  player.sendMessage("Your pouch has decayed through use.");
}

/** "runecrafting:repair-pouches": every decayed pouch the player carries is whole again. */
function repairPouches(request) {
  const { player } = request;
  const inventory = player.getInventory();
  let repaired = 0;
  for (const pouch of POUCHES) {
    if (!pouch.degraded) continue;
    const state = stateOf(player, pouch);
    const decayed = inventory.getAmount(objId(pouch.degraded));
    if (decayed > 0) {
      inventory.delete(objId(pouch.degraded), decayed);
      inventory.adds(objId(pouch.item), decayed);
      repaired += decayed;
    }
    if (decayed > 0 || state.decay) {
      state.decay = 0;
      save(player, pouch, state);
    }
  }
  if (repaired > 0) inventory.refreshItems();
  request.repaired = repaired;
}

/** "runecrafting:remove-guardian-essence": guardian essence can't leave the minigame. */
function removeGuardianEssence({ player }) {
  for (const pouch of POUCHES) {
    const state = stateOf(player, pouch);
    if (state.type !== GUARDIAN_ESSENCE_TYPE) continue;
    state.amount = 0;
    save(player, pouch, state);
  }
}

// ------------------------------------------------------------------ the abyssal needle

const STITCHED = ["small", "medium", "large", "giant"];
const STITCH_CRAFTING = 56;
const STITCH_RUNECRAFT = 25;
const STITCH_XP = 1000;

function stitch(event) {
  const { player } = event;
  const inventory = player.getInventory();
  const pouches = STITCHED.map((key) => POUCHES.find((pouch) => pouch.key === key));
  if (!pouches.every((pouch) => inventory.contains(objId(pouch.item)))) return false;
  const skills = player.getSkillManager();
  if (skills.getMaxLevel(core.Skill.CRAFTING) < STITCH_CRAFTING || runecraftLevel(player) < STITCH_RUNECRAFT) {
    player.sendMessage("You need level 56 Crafting to even attempt stitching these together.");
    return true;
  }
  if (pouches.some((pouch) => stateOf(player, pouch).amount > 0)) {
    player.sendMessage("You should empty your pouches before stitching them together.");
    return true;
  }
  for (const pouch of pouches) inventory.delete(objId(pouch.item), 1);
  const colossal = POUCHES.find((pouch) => pouch.key === "colossal");
  inventory.adds(objId(colossal.item), 1);
  inventory.refreshItems();
  skills.addExperiences(core.Skill.CRAFTING, STITCH_XP);
  player.sendMessage("You attempt to stitch together all of the pouches.");
  player.sendMessage(`Your colossal pouch can hold ${capacity(player, colossal)} essence.`);
  return true;
}

function login({ player }) {
  for (const pouch of POUCHES) sync(player, pouch, stateOf(player, pouch));
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  api.onPlayerLogin(login);
  api.onItemAction("Small pouch", { Fill: fill, Check: check, Empty: empty });
  api.onItemAction("Medium pouch", { Fill: fill, Check: check, Empty: empty });
  api.onItemAction("Large pouch", { Fill: fill, Check: check, Empty: empty });
  api.onItemAction("Giant pouch", { Fill: fill, Check: check, Empty: empty });
  api.onItemAction("Colossal pouch", { Fill: fill, Check: check, Empty: empty });
  api.onCustomEvent("runecrafting:remove-guardian-essence", removeGuardianEssence);
  api.onItemOnItem("Abyssal needle", "Small pouch", stitch);
  api.onItemOnItem("Abyssal needle", "Medium pouch", stitch);
  api.onItemOnItem("Abyssal needle", "Large pouch", stitch);
  api.onItemOnItem("Abyssal needle", "Giant pouch", stitch);
  api.onCustomEvent("runecrafting:repair-pouches", repairPouches);
}

module.exports = { attach, words, POUCHES_ATTRIBUTE, _test: { states, capacity, pouchFor } };
