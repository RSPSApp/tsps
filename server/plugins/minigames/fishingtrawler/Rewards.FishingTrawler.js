"use strict";

/**
 * The catch (Wiki: Fishing Trawler, Angler's outfit): back in port, each player with at least 50
 * contribution and 15 Fishing has their share waiting in the trawler net on the Port Khazard
 * dock. Each fish tries the highest tier the player can catch first, then the next one down, so
 * higher tiers take over as the level rises (the Wiki's success chart); up to two junk items come
 * with it. Each catch has a 1 in 12 chance of a piece of the current incomplete angler set,
 * up to two sets. A
 * successful trip also rolls the heron at 1/5,000, 1/2,500 with a full meter. Inspecting the net
 * sends the catch to the bank with its Fishing experience (the fish's own trawler XP).
 * The catch survives logging out; the next trip throws it back (Lobby.FishingTrawler.js).
 */

const Shared = require("./Shared.FishingTrawler");

const ANGLER_PIECES = ["anglerHat", "anglerTop", "anglerLegs", "anglerBoots"];
/** Junk per catch: none, one or two (the Wiki gives 0 to 2). */
const JUNK_WEIGHTS = [47, 37, 16];

function ownedAmount(player, itemId) {
  const { Bank } = Shared.core();
  let amount = player.getInventory().getAmount(itemId) + player.getEquipment().getAmount(itemId);
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX) amount += player.getBank(tab).getAmount(itemId);
  }
  return amount;
}

function rollJunk(random) {
  let roll = random() * JUNK_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  for (let count = 0; count < JUNK_WEIGHTS.length; count++) {
    roll -= JUNK_WEIGHTS[count];
    if (roll < 0) return count;
  }
  return 0;
}

/** The items and experience for `fishCount` fish at `fishingLevel`: { items: [[id, n]], xp }. */
/** One fish: the highest tier the level allows, else the next down, down to the lowest. */
function rollFish(eligible, random) {
  const byLevel = [...eligible].sort((a, b) => b.level - a.level);
  const success = Shared.DATA.catch.tierSuccess;
  for (let i = 0; i < byLevel.length - 1; i++) {
    if (random() < success) return byLevel[i];
  }
  // The lowest tier shares out evenly (shrimps, anchovies and sardines all come at 15).
  const lowest = byLevel.filter((fish) => fish.level === byLevel[byLevel.length - 1].level);
  return lowest[Math.floor(random() * lowest.length)];
}

function rollCatch(fishCount, fishingLevel, random = Math.random, ownsPiece = () => 0) {
  const ids = Shared.ids();
  const eligible = ids.fish.filter((fish) => fish.level <= fishingLevel);
  const counts = new Map();
  let xp = 0;
  const add = (id, n = 1) => counts.set(id, (counts.get(id) ?? 0) + n);
  for (let i = 0; i < fishCount && eligible.length > 0; i++) {
    const fish = rollFish(eligible, random);
    add(fish.id);
    xp += fish.xp;
  }
  const junk = Math.min(Shared.DATA.catch.junkMax, rollJunk(random));
  for (let i = 0; i < junk; i++) {
    add(ids.junk[Math.floor(random() * ids.junk.length)]);
    xp += Shared.DATA.junkXp;
  }
  // Complete the first set before the second; never award a third set (Wiki).
  const angler = [];
  const pieces = ANGLER_PIECES.map((piece) => ids.items[piece]);
  const owned = pieces.map((id) => Number(ownsPiece(id)));
  const limit = Math.min(2, Math.min(...owned) + 1);
  const missing = pieces.filter((_id, index) => owned[index] < limit);
  if (missing.length > 0 && Math.floor(random() * Shared.DATA.anglerChance) === 0) {
    const id = missing[Math.floor(random() * missing.length)];
    add(id);
    angler.push(id);
  }
  return { items: [...counts], xp: Math.round(xp * 10) / 10, angler };
}

/** At the end of a trip in port: the player's share into the net, or why there is none. */
function award(player, voyage, random = Math.random) {
  const points = voyage.contribution.get(player) ?? 0;
  if (Shared.baseLevel(player, "FISHING") < Shared.DATA.rewardFishingLevel) {
    player.sendMessage(Shared.message("lowLevel"));
    return null;
  }
  if (points < Shared.DATA.points.rewardMinimum) {
    player.sendMessage(Shared.message("tooLittle"));
    return null;
  }
  const reward = rollCatch(voyage.shareFor(player), Shared.baseLevel(player, "FISHING"), random, (id) => ownedAmount(player, id));
  player.setAttribute(Shared.REWARD_ATTRIBUTE, { items: reward.items, xp: reward.xp });
  const fish = Object.freeze(reward.items
    .filter(([id]) => Shared.ids().fish.some((entry) => entry.id === id))
    .map(([itemId, amount]) => Object.freeze({ itemId, amount })));
  if (fish.length > 0) Shared.api().emitCustomEvent("fishing-trawler:catch-awarded", { player, fish });
  rollHeron(player, points);
  return reward;
}

/** The heron: 1/5,000 on a successful trip, 1/2,500 with a full meter (Wiki), through Pets. */
function rollHeron(player, points) {
  const { chance, fullMeterChance } = Shared.DATA.heron;
  const petChance = points >= Shared.DATA.points.max ? fullMeterChance : chance;
  const api = Shared.api();
  if (typeof api?.emitCustomEvent !== "function") return;
  api.emitCustomEvent("fishing:success", { player, skill: Shared.core().Skill.FISHING, petChance, itemId: null, source: "fishing-trawler" });
}

/** Inspect the trawler net on the dock: the catch to the bank, its experience to Fishing. */
function inspectNet({ player }) {
  const reward = player.getAttribute(Shared.REWARD_ATTRIBUTE);
  if (!reward || !Array.isArray(reward.items) || reward.items.length === 0) {
    player.sendMessage(Shared.message("nothingInNet"));
    return true;
  }
  const { Bank, Item } = Shared.core();
  const anglers = new Set(ANGLER_PIECES.map((piece) => Shared.ids().items[piece]));
  const left = [];
  const xpFor = (id) => Shared.ids().fish.find((fish) => fish.id === id)?.xp
    ?? (Shared.ids().junk.includes(id) ? Shared.DATA.junkXp : 0);
  let totalXp = 0;
  let deliveredXp = 0;
  for (const [id, count] of reward.items) {
    const bank = player.getBank(Bank.getTabForItem(player, id));
    const amount = bank.getAddableAmount(new Item(id, count));
    totalXp += count * xpFor(id);
    if (amount > 0) {
      const before = bank.getAmount(id);
      bank.add(new Item(id, amount), false);
      const accepted = Math.max(0, bank.getAmount(id) - before);
      deliveredXp += accepted * xpFor(id);
      if (accepted > 0) {
        Shared.api().emitCustomEvent("items:obtained", {
          player,
          itemId: id,
          amount: accepted,
          source: "fishing-trawler",
          location: player.getLocation().clone(),
        });
        if (anglers.has(id)) {
          Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: id, amount: accepted });
          player.sendMessage(Shared.message("angler"));
        }
      }
      if (accepted < count) left.push([id, count - accepted]);
    } else {
      left.push([id, count]);
    }
  }
  const xp = totalXp > 0 ? Math.round((reward.xp * deliveredXp / totalXp) * 10) / 10 : 0;
  Shared.addXp(player, "FISHING", left.length === 0 ? reward.xp : xp);
  player.setAttribute(Shared.REWARD_ATTRIBUTE, left.length === 0 ? null : { items: left, xp: Math.max(0, Math.round((reward.xp - xp) * 10) / 10) });
  player.sendMessage(Shared.message(left.length === 0 ? "collected" : "bankFull"));
  return true;
}

function attachRewards(api) {
  Shared.bind(api);
  api.persistAttribute(Shared.REWARD_ATTRIBUTE, null);
  api.onObjectInteraction("Trawler net", { Inspect: inspectNetOrBoat });
}

/** The dock's net holds the catch; the trawler's own nets are for checking the net at sea. */
function inspectNetOrBoat(event) {
  if (event.objectId === Shared.ids().locs.rewardNet) return inspectNet(event);
  return false;
}

module.exports = { attachRewards, rollCatch, rollFish, rollHeron, award, inspectNet, ANGLER_PIECES };
