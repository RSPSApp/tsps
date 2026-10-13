/**
 * Her loot (Wiki), on the ground where it landed in the capture, nine ticks after her death:
 * everyone who hurt both her shield and the totems gets a roll of her table; big bones go to whoever
 * did the most, and plain bones only come with a unique. Phosani's always drops big bones.
 */
const Common = require("./Common.Nightmare");

const UNIQUE_NAMES = [
  "NIGHTMARE_STAFF", "INQUISITORS_GREAT_HELM", "INQUISITORS_HAUBERK", "INQUISITORS_PLATESKIRT",
  "INQUISITORS_MACE", "ELDRITCH_ORB", "HARMONISED_ORB", "VOLATILE_ORB",
];

/** Damage a player has done to her shield and to the totems, for loot. */
function credit(fight, player, kind, amount) {
  if (!player || amount <= 0) return;
  fight.contribution = fight.contribution ?? new Map();
  const entry = fight.contribution.get(player) ?? { shield: 0, totems: 0 };
  entry[kind] += amount;
  fight.contribution.set(player, entry);
}

function reward(fight, players) {
  const contribution = fight.contribution ?? new Map();
  const eligible = players.filter((player) => {
    const entry = contribution.get(player);
    return entry && entry.shield > 0 && entry.totems > 0;
  });
  if (eligible.length === 0) return;
  const total = (player) => contribution.get(player).shield + contribution.get(player).totems;
  const mvp = eligible.reduce((best, player) => (total(player) > total(best) ? player : best));
  const npcId = fight.phosani ? Common.data.npcs.phosani.sets["1"] : Common.data.npcs.phases[0];
  const { Item, ItemDefinition, ItemIdentifiers } = Common.core;
  const uniques = new Set(UNIQUE_NAMES.map((name) => ItemIdentifiers[name]));
  const manager = Common.api.getItemOnGroundManager();
  const where = fight.dream.tile(Common.data.arena.lootTile);
  for (const player of eligible) {
    const request = { player, npcId, drops: [] };
    Common.api.emitCustomEvent("npc-drops:roll-table", request);
    let drops = request.drops;
    if (!fight.phosani) {
      const unique = drops.some((drop) => uniques.has(drop.itemId));
      drops = drops.filter((drop) => {
        if (drop.itemId === ItemIdentifiers.BIG_BONES) return player === mvp;
        return drop.itemId === ItemIdentifiers.BONES ? unique : true;
      });
    }
    Common.api.emitCustomEvent("npc-drops:roll", { player, npc: fight.boss, npcId, drops, damagers: eligible });
    for (const drop of drops) {
      if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
      const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
      const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
      if (ItemDefinition.forId(itemId).isStackable()) {
        manager.registerLocation(player, new Item(itemId, drop.amount), where, fight.dream.area);
      } else {
        for (let i = 0; i < drop.amount; i++) manager.registerLocation(player, new Item(itemId, 1), where, fight.dream.area);
      }
    }
  }
  fight.contribution = new Map();
}

module.exports = { reward, credit };
