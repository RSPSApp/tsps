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

/**
 * Wiki (The Nightmare, Drops): her unique tables roll per kill, not per player - "when unique drops are rolled, a
 * weighting system based on damage dealt determines which player will receive it" - with a second roll of both
 * tables at (party size - 5)%, from 0 to 75%. Everyone eligible still rolls the rest of the table.
 */
const SECOND_ROLL_FROM_PARTY = 5;
/**
 * Wiki (The Nightmare): the pet is 1/800 solo, 1/1,600 for 2, ... 1/4,000 for 5 or more - her table's 1/800, shared;
 * "The team size is counted when the fight starts."
 */
const PET_ITEM_ID = 24491; // Little nightmare
const PET_SHARE_MAX_PARTY = 5;
const SECOND_ROLL_MAX_PERCENT = 75;

/** Damage a player has done to her shield and to the totems, for loot. */
function credit(fight, player, kind, amount) {
  if (!player || amount <= 0) return;
  fight.contribution = fight.contribution ?? new Map();
  const entry = fight.contribution.get(player) ?? { shield: 0, totems: 0 };
  entry[kind] += amount;
  fight.contribution.set(player, entry);
}

/** The boss whose loot is being placed, and who is owed it, while reward() emits each roll. */
const rewarding = new WeakMap();

/**
 * Wiki (Ironman Mode): "Iron accounts receive group-boss rewards when fighting with others", The Nightmare among them,
 * so an Ironman's own roll of a team kill is kept, not wiped as a shared kill.
 */
function ironmanKeeps(request) {
  if (!rewarding.get(request?.npc)?.has(request.player)) return;
  request.keep.push(...request.drops.map((drop) => drop.itemId));
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
  const rollTable = (player) => {
    const request = { player, npcId, drops: [] };
    Common.api.emitCustomEvent("npc-drops:roll-table", request);
    return request.drops;
  };
  // The whole party, counted when the fight starts (Wiki, for the pet), as the shield and totems are (fight.teamSize,
  // set in awaken()): not only the players who earned a roll.
  const partySize = Math.max(1, fight.teamSize ?? players.length);
  // The kill's uniques, each to one player by weight of damage (Phosani's is solo: her own roll keeps them).
  const awarded = new Map();
  if (!fight.phosani) {
    const secondChance = Math.max(0, Math.min(SECOND_ROLL_MAX_PERCENT, partySize - SECOND_ROLL_FROM_PARTY));
    const rolls = 1 + (Math.random() * 100 < secondChance ? 1 : 0);
    for (let roll = 0; roll < rolls; roll++) {
      for (const drop of rollTable(mvp).filter((entry) => uniques.has(entry.itemId))) {
        let pick = Math.random() * eligible.reduce((sum, player) => sum + total(player), 0);
        const winner = eligible.find((player) => (pick -= total(player)) < 0) ?? mvp;
        awarded.set(winner, [...(awarded.get(winner) ?? []), drop]);
      }
    }
  }
  for (const player of eligible) {
    let drops = rollTable(player);
    if (!fight.phosani) {
      const won = awarded.get(player) ?? [];
      const petShare = Math.min(PET_SHARE_MAX_PARTY, partySize);
      drops = [...drops.filter((drop) => !uniques.has(drop.itemId)), ...won].filter((drop) => {
        if (drop.itemId === PET_ITEM_ID) return Math.random() * petShare < 1;
        if (drop.itemId === ItemIdentifiers.BIG_BONES) return player === mvp;
        return drop.itemId === ItemIdentifiers.BONES ? won.length > 0 : true;
      });
    }
    // The kill is counted by the fight's own count(); this roll only logs the loot.
    if (fight.boss) rewarding.set(fight.boss, new Set(eligible));
    try {
      Common.api.emitCustomEvent("npc-drops:roll", { player, npc: fight.boss, npcId, drops, damagers: eligible, countKill: false });
    } finally {
      if (fight.boss) rewarding.delete(fight.boss);
    }
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

module.exports = { reward, credit, ironmanKeeps };
