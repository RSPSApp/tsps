/**
 * Soul Harvest (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 5 relic: while its toggle is on (the default), the bones and ashes an NPC would drop for
 * the relic's owner come as stackable Soul shards instead, roughly the bones' blessed bone shards
 * (the data's `shards`), straight to the inventory when it has room for them, else on the floor
 * with the rest of the drop. Every farming crop harvested comes as shards too: one for each 4
 * Farming XP the harvest pays (not the league's rate; fractions carry to the next pick: ours).
 * Not here: the shards from checking a crop's health (the check tells no XP), and their uses
 * (Runecraft essence, the Teomat's libation bowl).
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

/** `farming:pick`: shards for the pick's Farming XP in place of the crop. */
function picked(pick) {
  if (!active(pick.player) || !Number.isFinite(pick.experience)) return;
  const xp = (owedXp.get(pick.player) ?? 0) + Math.max(0, pick.experience);
  const shards = Math.floor(xp / effect.farmingXpPerShard);
  owedXp.set(pick.player, xp - shards * effect.farmingXpPerShard);
  if (shards > 0) {
    pick.itemId = shardId();
    pick.amount = shards;
    pick.stored = 0;
  } else {
    pick.stored = pick.amount;
  }
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.soulHarvest;
  api.onCustomEvent("npc-drops:generated", drops);
  api.onCustomEvent("farming:pick", picked);
};
