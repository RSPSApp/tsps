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
 * - Food: Psykk bats from the Thieving room count as cooked by whoever found them; "gradually
 *   diminishing" past the soft cap is a straight line down to the hard cap here (the shape is
 *   not on the Wiki).
 * - Potions: "their maker or whoever got them from a boss"; Vespula's give nobody points and
 *   don't count towards the cap (Chambers of Xeric/Strategies).
 * rsprox captures (3282, 3285, 820; the sips by the drinker themselves): an overload (+) sip is 400
 *   points and a prayer enhance (+) sip 112, each shown as two equal raises of the party score on
 *   one tick. The Wiki's "appropriate use": a second sip of these two gives nothing while the
 *   last is still working (none at 331-376 ticks, 3282:137672, 3285:240966, 241014, 263773,
 *   263907; points again from 458, 820:96651). All these worlds were Grid Master, whose Bottomless
 *   Brew is why no dose was used up; nothing shows it changed the points, but no normal world
 *   confirms them.
 * Not in a capture: every other potion (Xeric's aid 200, others 100) and the x 0.25 / 0.5 by
 *   strength; x 1.5 for someone else's, no food eaten or cooked; the 5 extra sips' half points.
 * The maker is carried on the item (its meta, kept through the inventory, ground drops and the
 *   storage units): set when it is cooked or mixed; food or a potion with no maker yet gets
 *   whoever picks it up, which is how boss drops and any bats left on the ground are credited.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

const FOOD_TIERS = [
  [20856, 20858, 20860, 20862, 20864, 20866, 20868],
  [20871, 20873, 20875, 20877, 20879, 20881, 20883],
];
const FOOD_TIER = new Map(FOOD_TIERS.flatMap((ids) => ids.map((id, tier) => [id, tier])));
const OTHER_EATER_BONUS = 1.5;
/** The item meta naming who gets points for it; NO_CREDIT for nobody. */
const META_MAKER = "cox:maker";
const NO_CREDIT = "";
const FOOD_SOFT_CAP = 20;
const FOOD_HARD_CAP = 40;

/** Gourd potion families: first 1-dose id of the weak, normal and strong ones; points per sip. */
const POTION_FAMILIES = [
  { key: "elder", first: [20913, 20917, 20921], points: 100 },
  { key: "twisted", first: [20925, 20929, 20933], points: 100 },
  { key: "kodai", first: [20937, 20941, 20945], points: 100 },
  { key: "revitalisation", first: [20949, 20953, 20957], points: 100 },
  { key: "prayer-enhance", first: [20961, 20965, 20969], points: 112, resipTicks: 400 },
  { key: "xerics-aid", first: [20973, 20977, 20981], points: 200 },
  { key: "overload", first: [20985, 20989, 20993], points: 400, resipTicks: 400 },
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

function isSupply(itemId) {
  return POTION_BY_ID.has(itemId) || FOOD_TIER.has(itemId);
}

/** Names `maker` on up to `amount` of an item the player holds with no maker yet. */
function credit(player, itemId, amount = 1, maker = player.getUsername()) {
  let left = amount;
  for (const item of player.getInventory().getItems()) {
    if (left <= 0) return;
    if (item?.getId() !== itemId || item.getMetaValue(META_MAKER) !== undefined) continue;
    item.setMetaValue(META_MAKER, maker);
    left--;
  }
}

function raiderNamed(raid, username) {
  return [...raid.players].find((player) => player.getUsername() === username) ?? null;
}

function cooked({ player, itemId }) {
  const raid = Raid.raidOf(player);
  if (raid && FOOD_TIER.has(itemId)) credit(player, itemId);
}

/** Supplies with no maker go to whoever gets them; those from Vespula's room, to nobody. */
function pickedUp({ player, groundItem, itemId, amount }) {
  const raid = Raid.raidOf(player);
  if (!raid || !isSupply(itemId) || groundItem.getItem().getMetaValue(META_MAKER) !== undefined) return;
  const maker = raid.roomAt(groundItem.getPosition())?.key === "VESPULA" ? NO_CREDIT : player.getUsername();
  // The item reaches the inventory after this event, whose caller refuses a changed one.
  Shared.later(player, 1, () => credit(player, itemId, amount, maker));
}

function ate({ player, itemId, heal, meta }) {
  const raid = Raid.raidOf(player);
  if (!raid || !FOOD_TIER.has(itemId) || !(heal > 0) || raid.stage === Raid.STAGE.WAITING) return;
  const maker = raiderNamed(raid, meta?.[META_MAKER]);
  if (!maker) return;
  const eaten = (raid.foodEaten = (raid.foodEaten ?? 0) + 1);
  const raiders = raid.scale;
  if (eaten > FOOD_HARD_CAP * raiders) return;
  let points = 4 + 8 * FOOD_TIER.get(itemId);
  if (maker !== player) points *= OTHER_EATER_BONUS;
  if (eaten > FOOD_SOFT_CAP * raiders) points *= (FOOD_HARD_CAP * raiders - eaten + 1) / ((FOOD_HARD_CAP - FOOD_SOFT_CAP) * raiders);
  raid.addPoints(maker, Math.floor(points));
}

/** Whether this sip is another of the same family while the drinker's last is still working. */
function sippedTooSoon(raid, player, family) {
  if (!family.resipTicks) return false;
  raid.lastSips ??= new Map();
  const key = `${player.getUsername()}:${family.key}`;
  const last = raid.lastSips.get(key);
  raid.lastSips.set(key, Shared.cycle());
  return last != null && Shared.cycle() - last < family.resipTicks;
}

function drank({ player, itemId, meta }) {
  const raid = Raid.raidOf(player);
  const potion = POTION_BY_ID.get(itemId);
  if (!raid || !potion || raid.stage === Raid.STAGE.WAITING) return;
  const tooSoon = sippedTooSoon(raid, player, potion.family);
  const maker = raiderNamed(raid, meta?.[META_MAKER]);
  if (!maker || tooSoon) return;
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
  api.onCustomEvent("ground-items:take", pickedUp);
  api.onCustomEvent("food:eaten", ate);
  api.onCustomEvent("potions:drunk", drank);
  api.onCustomEvent("potions:area", potionArea);
};

Object.assign(module.exports, { META_MAKER, NO_CREDIT, credit, cooked, pickedUp, ate, drank, potionArea, POTION_BY_ID });
