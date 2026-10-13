"use strict";

/**
 * Points for the raid's food and potions, given to whoever made them; and the raid's answer to
 * the Potions plugin asking whether a player may sip a raid potion.
 *
 * Wiki (Chambers of Xeric, Gaining points):
 * - Food: when anyone eats raid food the cook gets 4 + 8 x its tier (fish and bats are tiers
 *   0-6), 50% more when someone else eats it; a soft cap of 20 x raiders pieces and a hard cap
 *   of 40 x raiders.
 * - Potions: their maker gets points per sip, more when someone else drinks; capped at 5 sips
 *   per raider plus 5 more at a reduced amount.
 * Wiki-derived amounts (the Wiki gives no numbers per sip): an overload sip
 *   400, Xeric's aid 200, others 100, x 0.25 / 0.5 / 1 by strength, x 1.5 someone else's.
 * Not like OSRS: items carry no maker here, so the raid keeps who made each kind; a sip or bite
 *   is credited to the eater if they made some of that kind, otherwise to the first other maker,
 *   otherwise nobody gets points (boss drops come later). Between the soft and hard food caps,
 *   and for the 5 extra sips, points are halved.
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");

const FOOD_TIERS = [
  [20856, 20858, 20860, 20862, 20864, 20866, 20868],
  [20871, 20873, 20875, 20877, 20879, 20881, 20883],
];
const FOOD_TIER = new Map(FOOD_TIERS.flatMap((ids) => ids.map((id, tier) => [id, tier])));
const OTHER_EATER_BONUS = 1.5;
const FOOD_SOFT_CAP = 20;
const FOOD_HARD_CAP = 40;

/** Gourd potion families: first 1-dose id of the weak, normal and strong ones; points per sip. */
const POTION_FAMILIES = [
  { key: "elder", first: [20913, 20917, 20921], points: 100 },
  { key: "twisted", first: [20925, 20929, 20933], points: 100 },
  { key: "kodai", first: [20937, 20941, 20945], points: 100 },
  { key: "revitalisation", first: [20949, 20953, 20957], points: 100 },
  { key: "prayer-enhance", first: [20961, 20965, 20969], points: 100 },
  { key: "xerics-aid", first: [20973, 20977, 20981], points: 200 },
  { key: "overload", first: [20985, 20989, 20993], points: 400 },
  { key: "antipoison", first: [25754, 25758, 25762], points: 100 },
];
const STRENGTH = [0.25, 0.5, 1];
const POTION_BY_ID = new Map();
for (const family of POTION_FAMILIES) {
  family.first.forEach((first, tier) => {
    for (let dose = 1; dose <= 4; dose++) POTION_BY_ID.set(first + dose - 1, { family, tier, dose });
  });
}
const EXTRA_SIPS = 5;
const SIPS_PER_RAIDER = 5;

/** The maker-tracking key of a raid supply: its potion family and strength, or food and tier. */
function supplyKey(itemId) {
  const potion = POTION_BY_ID.get(itemId);
  if (potion) return `${potion.family.key}:${potion.tier}`;
  const tier = FOOD_TIER.get(itemId);
  return tier == null ? null : `food:${tier}`;
}

function madeOf(raid) {
  raid.made ??= new Map();
  return raid.made;
}

function recordMade(raid, key, player) {
  if (!key) return;
  const list = madeOf(raid).get(key) ?? [];
  list.push(player.getUsername());
  madeOf(raid).set(key, list);
}

/** Who made the thing a player just ate or drank; `use` takes it off the list. */
function makerFor(raid, key, player, use) {
  const list = madeOf(raid).get(key);
  if (!list?.length) return null;
  const own = list.indexOf(player.getUsername());
  const index = own >= 0 ? own : 0;
  const maker = list[index];
  if (use) list.splice(index, 1);
  return maker;
}

function raiderNamed(raid, username) {
  return [...raid.players].find((player) => player.getUsername() === username) ?? null;
}

function cooked({ player, itemId }) {
  const raid = Raid.raidOf(player);
  if (raid && FOOD_TIER.has(itemId)) recordMade(raid, supplyKey(itemId), player);
}

function ate({ player, itemId, heal }) {
  const raid = Raid.raidOf(player);
  if (!raid || !FOOD_TIER.has(itemId) || !(heal > 0) || raid.stage === Raid.STAGE.WAITING) return;
  const maker = raiderNamed(raid, makerFor(raid, supplyKey(itemId), player, true));
  if (!maker) return;
  const eaten = (raid.foodEaten = (raid.foodEaten ?? 0) + 1);
  const raiders = raid.scale;
  if (eaten > FOOD_HARD_CAP * raiders) return;
  let points = 4 + 8 * FOOD_TIER.get(itemId);
  if (maker !== player) points *= OTHER_EATER_BONUS;
  if (eaten > FOOD_SOFT_CAP * raiders) points /= 2;
  raid.addPoints(maker, Math.floor(points));
}

function drank({ player, itemId }) {
  const raid = Raid.raidOf(player);
  const potion = POTION_BY_ID.get(itemId);
  if (!raid || !potion || raid.stage === Raid.STAGE.WAITING) return;
  const key = supplyKey(itemId);
  // The last dose finishes the gourd: its maker comes off the list.
  const maker = raiderNamed(raid, makerFor(raid, key, player, potion.dose === 1));
  if (!maker) return;
  const sips = (raid.potionSips = (raid.potionSips ?? 0) + 1);
  const cap = SIPS_PER_RAIDER * raid.scale;
  if (sips > cap + EXTRA_SIPS) return;
  let points = potion.family.points * STRENGTH[potion.tier];
  if (maker !== player) points *= OTHER_EATER_BONUS;
  if (sips > cap) points /= 2;
  raid.addPoints(maker, Math.floor(points));
}

/** Raid potions can only be sipped inside the raid. */
function potionArea(request) {
  if (request.area === "chambers-of-xeric" && Raid.raidOf(request.player)) request.inside = true;
}

module.exports = function registerCoxSupplies(api) {
  Shared.bind(api);
  api.onCustomEvent("cooking:success", cooked);
  api.onCustomEvent("food:eaten", ate);
  api.onCustomEvent("potions:drunk", drank);
  api.onCustomEvent("potions:area", potionArea);
};

Object.assign(module.exports, { supplyKey, recordMade, makerFor, cooked, ate, drank, potionArea, POTION_BY_ID });
