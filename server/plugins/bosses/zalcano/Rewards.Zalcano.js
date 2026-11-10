/**
 * Zalcano's rewards (Wiki: Zalcano, Zalcano_shard, Smolcano, Crystal_tool_seed):
 * - only players who did her armour at least 5 damage get anything;
 * - points: health + 2 x armour damage for the main table, min(health, 400) + 2 x min(armour,
 *   300) for the rest (at most 1,000);
 * - everyone eligible gets crystal shards (1, 2 with 31 damage, 3 for the MVP - most damage),
 *   and one roll on the main table whose quantities grow with their points; the MVP gets 10%
 *   more and the infernal ashes;
 * - each kill has a 1 in 200 unique (39 in 40 a crystal tool seed, else an uncut onyx) for one
 *   player with 31 damage, by points; each of them also rolls the Zalcano shard (1/1500 rising to
 *   1/750 at 1,000 points); those with 31 damage roll Smolcano (1/2250);
 * - the kill count goes up for everyone eligible.
 * Rolls go through NpcDrops (npc-drops:roll-table), loot goes down at each player's feet
 * (npc-drops:place), the pet through Pets (npc-drops:roll).
 */
const Common = require("./Common.Zalcano");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

function points({ shield, health }) {
  return {
    main: health + 2 * shield,
    tertiary: Math.min(health, 400) + 2 * Math.min(shield, 300),
  };
}

function eligible(entry) {
  return entry.shield >= Common.data.rewards.shieldMinimum;
}

function uniqueEligible(entry) {
  return eligible(entry) && entry.shield + entry.health >= Common.data.rewards.uniqueMinimum;
}

/** The player who did the most damage (armour and hitpoints together). */
function mvpOf(contributions) {
  let best = null;
  for (const [player, entry] of contributions) {
    const total = entry.shield + entry.health;
    if (eligible(entry) && (!best || total > best[1])) best = [player, total];
  }
  return best?.[0] ?? null;
}

/** The table's quantity for these points: its minimum, up to its maximum at fullPoints. */
function scaledAmount([min, max], mainPoints) {
  const share = Math.max(0, Math.min(1, mainPoints / Common.data.rewards.fullPoints));
  return Math.round(min + share * (max - min));
}

/** One main-table roll, its quantity scaled by points (the always and tertiary rows are Rewards'). */
function mainRoll(player, mainPoints, mvp) {
  const { items } = Common.ids;
  const own = new Set([items.crystalShard, items.infernalAshes, items.toolSeed, items.uncutOnyx, items.shard, items.pet]);
  const ranges = new Map();
  const request = {
    player,
    npcId: Common.ids.npcs.armoured,
    drops: [],
    entryFilter(entry) {
      const weighted = Number.isFinite(entry.weight) && entry.weight > 0 && !own.has(entry.item_id);
      if (weighted && Array.isArray(entry.quantity)) ranges.set(entry.item_id, entry.quantity);
      return weighted;
    },
  };
  Common.api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops.map((drop) => {
    const range = ranges.get(drop.itemId);
    let amount = range ? scaledAmount(range, mainPoints) : drop.amount;
    if (mvp) amount = Math.ceil(amount * (1 + Common.data.rewards.mvpBonus));
    return { ...drop, amount: Math.max(1, amount) };
  });
}

/** Zalcano shard: 1/1500 at the least, 1/750 at 1,000 tertiary points. */
function shardChance(tertiaryPoints) {
  const [low, high] = Common.data.rewards.shardChance;
  const share = Math.max(0, Math.min(1, tertiaryPoints / 1000));
  return 1 / low + share * (1 / high - 1 / low);
}

/** The unique's owner: one of the unique-eligible, weighted by tertiary points. */
function uniqueOwner(contributions, random) {
  const pool = [...contributions].filter(([, entry]) => uniqueEligible(entry));
  const total = pool.reduce((sum, [, entry]) => sum + points(entry).tertiary, 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const [player, entry] of pool) {
    roll -= points(entry).tertiary;
    if (roll < 0) return player;
  }
  return pool.at(-1)[0];
}

/** Rolls and hands out everything for one kill; returns { player: drops } for the eligible. */
function share(contributions, random = Math.random, npc = null) {
  const { items } = Common.ids;
  const { rewards } = Common.data;
  const mvp = mvpOf(contributions);
  const loot = new Map();
  for (const [player, entry] of contributions) {
    if (!eligible(entry)) {
      if (entry.shield + entry.health > 0) player.sendMessage(Common.message("tooLittle"));
      continue;
    }
    const { main, tertiary } = points(entry);
    const isMvp = player === mvp;
    const drops = [{ itemId: items.crystalShard, amount: isMvp ? 3 : uniqueEligible(entry) ? 2 : 1 }];
    if (isMvp) drops.push({ itemId: items.infernalAshes, amount: 1 });
    drops.push(...mainRoll(player, main, isMvp));
    if (uniqueEligible(entry) && random() < shardChance(tertiary)) drops.push({ itemId: items.shard, amount: 1 });
    // Pets.plugin.js takes the pet out of the drops on npc-drops:roll.
    if (uniqueEligible(entry) && random() < 1 / rewards.petChance) drops.push({ itemId: items.pet, amount: 1 });
    loot.set(player, drops);
  }
  if (random() < 1 / rewards.uniqueChance) {
    const owner = uniqueOwner(contributions, random);
    if (owner) {
      const seed = random() < rewards.seedWeight / (rewards.seedWeight + rewards.onyxWeight);
      loot.get(owner)?.push({ itemId: seed ? items.toolSeed : items.uncutOnyx, amount: 1 });
    }
  }
  const damagers = [...loot.keys()];
  for (const [player, drops] of loot) {
    // As any kill's: the collection log, Ironman and pet rules see it.
    Common.api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: Common.ids.npcs.weakened, drops, damagers });
    Common.api.emitCustomEvent("npc-drops:place", { player, drops, location: player.getLocation() });
    countKill(player);
  }
  return loot;
}

/** Individual contribution rewards survive the Ironman shared-kill filter. */
function ironmanKeeps(request) {
  if (request.npcId !== Common.ids.npcs.weakened) return;
  const entry = request.npc?.__zalFight?.contributions.get(request.player);
  if (entry && eligible(entry)) request.keep.push(...request.drops.map(drop => drop.itemId));
}

function countKill(player) {
  const kills = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig?.(Common.ids.varps.kills, kills);
  sendBossKillCount(player, Common.message("killCount", { kills }));
}

/** On login, the kill count's varp (the collection log and hiscores read it). */
function sendKills(player) {
  player.getPacketSender().sendConfig?.(Common.ids.varps.kills, Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0);
}

module.exports = { points, eligible, uniqueEligible, mvpOf, scaledAmount, mainRoll, shardChance, uniqueOwner, share, ironmanKeeps, countKill, sendKills };
