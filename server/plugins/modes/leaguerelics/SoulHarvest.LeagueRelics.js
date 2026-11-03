/**
 * Soul Harvest (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 5 relic: while its toggle is on (the default), the bones and ashes an NPC would drop for
 * the relic's owner come as stackable Soul shards instead, roughly the bones' blessed bone shards
 * (the data's `shards`), straight to the inventory when it has room for them, else on the floor
 * with the rest of the drop. Every farming crop harvested comes as shards too: one for each 4
 * Farming XP the harvest pays (not the league's rate; fractions carry to the next pick: ours),
 * and for a health check's XP (`farming:check-health`), to the inventory when they fit (else they
 * stay owed: ours). The shards bind as pure essence at any altar that takes it
 * (`runecrafting:essence`).
 * Not here: the Teomat's libation bowl (100 shards for 550 Prayer XP), which the server lacks;
 * the shards as essence at the Ourania Altar, the combination runes and the minigames' altars,
 * which bind their own essence lists.
 */
const Common = require("./Common.LeagueRelics");
const Toggles = require("./Toggles.LeagueRelics");

let core;
let effect;
let shardsFor = null;

/** Farming XP not yet turned into a shard, per player. */
const owedXp = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function shardId() {
  return core.ItemIdentifiers[effect.shard];
}

/** Bone or ash item id (and its note) -> shards. */
function shardTable() {
  if (shardsFor) return shardsFor;
  shardsFor = new Map();
  for (const [name, shards] of Object.entries(effect.shards)) {
    const id = core.ItemIdentifiers[name];
    if (!Number.isInteger(id)) continue;
    shardsFor.set(id, shards);
    shardsFor.set(Common.noted(id), shards);
  }
  return shardsFor;
}

/** `npc-drops:generated`: the bones and ashes become shards, to the inventory when they fit. */
function drops({ player, drops: list }) {
  if (!player || !Array.isArray(list) || !active(player) || !Toggles.on(player, effect.bonesToggle)) return;
  const table = shardTable();
  let shards = 0;
  for (let index = list.length - 1; index >= 0; index--) {
    const per = table.get(list[index].itemId);
    if (per === undefined) continue;
    shards += per * Math.max(0, list[index].amount | 0);
    list.splice(index, 1);
  }
  if (shards <= 0) return;
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(new core.Item(shardId(), shards)) >= shards) inventory.adds(shardId(), shards);
  else list.push({ itemId: shardId(), amount: shards, noted: false });
}

/** The whole shards `experience` Farming XP (and what was owed) is worth, the rest kept owed. */
function shardsForXp(player, experience) {
  const xp = (owedXp.get(player) ?? 0) + Math.max(0, experience);
  const shards = Math.floor(xp / effect.farmingXpPerShard);
  owedXp.set(player, xp - shards * effect.farmingXpPerShard);
  return shards;
}

/** `farming:pick`: shards for the pick's Farming XP in place of the crop. */
function picked(pick) {
  if (!active(pick.player) || !Number.isFinite(pick.experience)) return;
  const shards = shardsForXp(pick.player, pick.experience);
  if (shards > 0) {
    pick.itemId = shardId();
    pick.amount = shards;
    pick.stored = 0;
  } else {
    pick.stored = pick.amount;
  }
}

/** `farming:check-health`: shards for the check's Farming XP, to the inventory when they fit. */
function checkedHealth({ player, experience }) {
  if (!active(player) || !Number.isFinite(experience)) return;
  const shards = shardsForXp(player, experience);
  if (shards <= 0) return;
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(new core.Item(shardId(), shards)) >= shards) inventory.adds(shardId(), shards);
  else owedXp.set(player, (owedXp.get(player) ?? 0) + shards * effect.farmingXpPerShard);
}

/** `runecrafting:essence`: the shards bind where pure essence does. */
function essence(request) {
  if (active(request.player)) request.pure.push(shardId());
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.soulHarvest;
  api.onCustomEvent("npc-drops:generated", drops);
  api.onCustomEvent("farming:pick", picked);
  api.onCustomEvent("farming:check-health", checkedHealth);
  api.onCustomEvent("runecrafting:essence", essence);
};
