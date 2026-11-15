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
 * - the kill count goes up for everyone eligible;
 * - a player who told Rhiannon "XP Focused." gets Mining XP instead of the main table: about main
 *   points + 5 x tertiary points (Wiki, Drops: "approximately P_M + P_T x 5"), with the Prospector
 *   kit's bonus. Shards, the MVP's ashes and the unique, shard and pet rolls stay as they are
 *   ("This does not affect the guaranteed drops or the unique drop table"). As recorded
 *   (rsprox_transcripts/227/910585.txt): the choice sets varbit zalcano_loot_customization to 1 as
 *   her reply shows (tick 4791), and later kills drop only the crystal shards, with the Mining XP
 *   on the kill tick (tick 4954: 2 shards, 8,105 XP).
 * Rolls go through NpcDrops (npc-drops:roll-table), loot goes down at each player's feet
 * (npc-drops:place), the pet through Pets (npc-drops:roll).
 */
const Common = require("./Common.Zalcano");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

/** The source the league's boosted drops name for these rolls (the Wiki's Zalcano row). */
const CHANCE_SOURCE = "Zalcano";

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

/** The league's chance rules for one player's rolls on this kill, asked as "drops:chance" is by the other rollers. */
function chanceRulesFor(player) {
  const rules = [];
  Common.api.emitCustomEvent("drops:chance", { player, source: CHANCE_SOURCE, rules });
  return rules;
}

/** `chance` times the multipliers of the rules matching `itemId`'s name, at most 1. */
function boostedChance(chance, rules, itemId) {
  const name = Common.api.core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
  let multiplier = 1;
  for (const rule of rules) if (rule.pattern.test(name)) multiplier *= rule.multiplier;
  return Math.min(1, chance * multiplier);
}

function xpFocused(player) {
  return player.getAttribute?.(Common.XP_FOCUS_ATTRIBUTE) === true;
}

function sendLootFocus(player) {
  player.getPacketSender().sendVarbit?.(Common.ids.varbits.lootFocus, xpFocused(player) ? 1 : 0);
}

/** "npc-dialogue:choice": Rhiannon's "Customise Zalcano Loot" menu (Wiki Transcript:Rhiannon). */
function chooseLoot({ player, npcId, option }) {
  if (npcId !== Common.ids.npcs.rhiannon || !player) return;
  if (option === "XP Focused.") player.setAttribute(Common.XP_FOCUS_ATTRIBUTE, true);
  else if (option === "Resource focused") player.setAttribute(Common.XP_FOCUS_ATTRIBUTE, false);
  else return;
  sendLootFocus(player);
}

/** The XP-focused reward: main points + 5 x tertiary points, times the Prospector kit's bonus. */
function focusExperience(player, { main, tertiary }) {
  const request = { player, multiplier: 1 };
  Common.api.emitCustomEvent("mining:xp-multiplier", request);
  return (main + Common.data.rewards.xpFocusTertiaryFactor * tertiary) * request.multiplier;
}

/** Rolls and hands out everything for one kill; returns { player: drops } for the eligible. */
function share(contributions, random = Math.random, npc = null) {
  const { items } = Common.ids;
  const { rewards } = Common.data;
  const mvp = mvpOf(contributions);
  const loot = new Map();
  const rulesOf = new Map();
  for (const [player, entry] of contributions) {
    if (!eligible(entry)) {
      if (entry.shield + entry.health > 0) player.sendMessage(Common.message("tooLittle"));
      continue;
    }
    const { main, tertiary } = points(entry);
    const isMvp = player === mvp;
    const drops = [{ itemId: items.crystalShard, amount: isMvp ? 3 : uniqueEligible(entry) ? 2 : 1 }];
    if (isMvp) drops.push({ itemId: items.infernalAshes, amount: 1 });
    if (!xpFocused(player)) drops.push(...mainRoll(player, main, isMvp));
    if (uniqueEligible(entry)) {
      const rules = chanceRulesFor(player);
      rulesOf.set(player, rules);
      if (random() < boostedChance(shardChance(tertiary), rules, items.shard)) drops.push({ itemId: items.shard, amount: 1 });
      // Pets.plugin.js takes the pet out of the drops on npc-drops:roll.
      if (random() < boostedChance(1 / rewards.petChance, rules, items.pet)) drops.push({ itemId: items.pet, amount: 1 });
    }
    loot.set(player, drops);
  }
  // One unique a kill: its owner, then one roll for the seed or the onyx, each its weight of the 1 in uniqueChance.
  const owner = uniqueOwner(contributions, random);
  const roll = random();
  if (owner) {
    const { seedWeight, onyxWeight } = rewards;
    const rules = rulesOf.get(owner) ?? [];
    const plain = 1 / rewards.uniqueChance;
    const seedChance = boostedChance(plain * seedWeight / (seedWeight + onyxWeight), rules, items.toolSeed);
    const onyxChance = boostedChance(plain * onyxWeight / (seedWeight + onyxWeight), rules, items.uncutOnyx);
    if (roll < seedChance) loot.get(owner)?.push({ itemId: items.toolSeed, amount: 1 });
    else if (roll < seedChance + onyxChance) loot.get(owner)?.push({ itemId: items.uncutOnyx, amount: 1 });
  }
  const damagers = [...loot.keys()];
  for (const [player, drops] of loot) {
    // As any kill's: the collection log, Ironman and pet rules see it.
    Common.api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: Common.ids.npcs.weakened, drops, damagers });
    Common.api.emitCustomEvent("npc-drops:place", { player, drops, location: player.getLocation(), npcId: Common.ids.npcs.weakened });
    const entry = contributions.get(player);
    if (xpFocused(player) && entry) {
      player.getSkillManager().addExperiences(Common.core.Skill.MINING, focusExperience(player, points(entry)));
    }
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
  sendLootFocus(player);
}

module.exports = { points, eligible, uniqueEligible, mvpOf, scaledAmount, mainRoll, shardChance, uniqueOwner, share, ironmanKeeps, countKill, sendKills,
  xpFocused, chooseLoot, focusExperience };
