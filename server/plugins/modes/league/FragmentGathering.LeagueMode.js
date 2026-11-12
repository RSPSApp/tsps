/**
 * Shattered Relics' harvesting fragments, Message In A Bottle, and the Greedy Gatherer and
 * Personal Banker sets (data/league-shattered.json `gatheringEffects`; Wiki /Fragments). Each
 * fragment works with the number its equipped level gives in the cache (Fragments.equippedValue),
 * each set with its tier (Fragments.setTier). They hear the gathering skills' own events:
 * `storage:gather` and `storage:room` (Mining, Woodcutting, Fishing), `farming:pick` and
 * `farming:plant-rules`, `mining:deplete-rock`, `woodcutting:nest-chance` / `nest-drop`,
 * `fishing:success`, `hunter:rewards` and `treasure-trails:vessel-chance`.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data } = require("./Shattered.LeagueMode");

/** Skill name -> skill, read once. */
let skillsByName = null;

function effects() {
  return data.gatheringEffects;
}

function core() {
  return Common.core;
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

function value(player, effect) {
  return Fragments.equippedValue(player, effects()[effect].fragment);
}

/** The value for a set's tier, or null below its first tier. */
function atTier(player, set, values) {
  const tier = Fragments.setTier(player, set);
  return tier > 0 ? values[Math.min(tier, values.length) - 1] : null;
}

function covers(effect, skill) {
  skillsByName ??= new Map();
  if (!skillsByName.has(effect)) skillsByName.set(effect, new Set(effects()[effect].skills.map((name) => core().Skill[name])));
  return skill !== undefined && skillsByName.get(effect).has(skill);
}

/** Greedy Gatherer: how many of each resource (1 without the set). */
function resources(player, skill) {
  const set = effects().greedyGatherer;
  return covers("greedyGatherer", skill) ? atTier(player, set.set, set.resources) ?? 1 : 1;
}

/** Personal Banker: whether this resource goes to the bank. */
function banks(player, skill) {
  const set = effects().personalBanker;
  const percent = covers("personalBanker", skill) ? atTier(player, set.set, set.chancePercent) : null;
  return percent !== null && chance(percent);
}

/** Whether every resource of the skill goes to the bank (Personal Banker's second tier). */
function alwaysBanks(player) {
  const set = effects().personalBanker;
  return (atTier(player, set.set, set.chancePercent) ?? 0) >= 100;
}

// ---- What a fragment makes of the resource: Chef's Catch, Molten Miner, Slash & Burn ----

/** `{ itemId, skill, xp, burnt }` for the gathered item, or null when no fragment changes it. */
function changed(player, skill, itemId) {
  const { Skill } = core();
  if (skill === Skill.FISHING) {
    const percent = value(player, "chefsCatch");
    if (percent === null || !chance(percent)) return null;
    const cooked = { rawId: itemId, cookedId: null, xp: null };
    Common.api.emitCustomEvent("cooking:cooked", cooked);
    return cooked.cookedId ? { itemId: cooked.cookedId, skill: Skill.COOKING, xp: Number(cooked.xp) || 0 } : null;
  }
  if (skill === Skill.MINING) {
    const percent = value(player, "moltenMiner");
    if (percent === null || !chance(percent)) return null;
    const bar = { oreId: itemId, barId: null, xp: null };
    Common.api.emitCustomEvent("smithing:bar-for-ore", bar);
    return bar.barId ? { itemId: bar.barId, skill: Skill.SMITHING, xp: Number(bar.xp) || 0 } : null;
  }
  if (skill === Skill.WOODCUTTING) {
    const percent = value(player, "slashAndBurn");
    if (percent === null || !chance(percent)) return null;
    const fire = { logId: itemId, xp: null };
    Common.api.emitCustomEvent("firemaking:log-xp", fire);
    return fire.xp > 0 ? { itemId: null, skill: Skill.FIREMAKING, xp: Number(fire.xp), burnt: true } : null;
  }
  return null;
}

/** What open containers (a fish barrel, a log basket) take of `amount` more: a `storage:gather` with no skill, so no fragment hears it. */
function intoContainers(player, itemId, amount) {
  const request = { player, itemId, amount, stored: 0 };
  Common.api.emitCustomEvent("storage:gather", request);
  return Math.min(amount, Math.max(0, Number(request.stored) || 0));
}

/**
 * `storage:gather`: the resource as the fragments and sets have it. What an open container took
 * stays as it is (the containers hear the event first); the rest, and Greedy Gatherer's extras with
 * their XP, are changed by the fragment, then banked (Personal Banker), or offered to the open
 * containers and put in the inventory, falling to the floor when it is full. A changed item the
 * bank has no room for is banked as it was gathered, without the change or its XP.
 */
function gather(request) {
  const { player, itemId, amount, skill } = request;
  if (!Number.isSafeInteger(amount) || amount <= 0 || skill === undefined) return;
  const times = resources(player, skill);
  let change = changed(player, skill, itemId);
  const toBank = banks(player, skill);
  if (times === 1 && !change && !toBank) return;
  const left = Math.max(0, amount - (Number(request.stored) || 0));
  const extra = amount * (times - 1);
  const pieces = left + extra;
  if (pieces <= 0) return;
  request.stored = amount;
  if (!change?.burnt) {
    let item = change?.itemId ?? itemId;
    let banked = toBank && Common.bank(player, item, pieces);
    if (toBank && !banked && change && Common.bank(player, itemId, pieces)) {
      change = null;
      item = itemId;
      banked = true;
    }
    if (!banked) {
      const loose = left + extra - (change ? 0 : intoContainers(player, item, extra));
      if (loose > 0) player.getInventory().forceAdd(player, new (core().Item)(item, loose));
    }
  }
  const skills = player.getSkillManager();
  if (extra > 0 && request.xp > 0) skills.addExperiences(skill, (request.xp * extra) / amount);
  if (change?.xp > 0) skills.addExperiences(change.skill, change.xp * pieces);
  // Burnt logs are lit logs to the other fragments (Hot On The Trail, Wiki).
  if (change?.burnt) for (let piece = 0; piece < pieces; piece++) Common.api.emitCustomEvent("league:log-burnt", { player, itemId });
}

/** `storage:room`: with every resource of Personal Banker's skills banked, a full inventory keeps gathering. */
function room(request) {
  if (!request.room && covers("personalBanker", request.skill) && alwaysBanks(request.player) && Common.bankHasRoom(request.player, request.itemId)) request.room = true;
}

// ---- Farming: Certified Farmer, Seedy Business and the sets ----

/**
 * `farming:pick`: noted and maybe doubled (Certified Farmer), more of it with its XP, maybe banked.
 * Farming hands over the pick's own amount, which must fit; the extras fall to the floor when
 * they don't, and none come when the pick itself doesn't fit.
 */
function pick(request) {
  const { player } = request;
  const { Skill } = core();
  const base = request.amount;
  const times = resources(player, Skill.FARMING);
  let amount = base * times;
  const farmer = value(player, "certifiedFarmer");
  if (farmer !== null) {
    request.itemId = Common.noted(request.itemId);
    if (chance(farmer)) amount *= 2;
  }
  const toBank = banks(player, Skill.FARMING);
  if (amount === base && !toBank) return;
  request.experience *= times;
  if (toBank && Common.bank(player, request.itemId, amount)) {
    request.amount = amount;
    request.stored = amount;
    return;
  }
  const { Item, ItemOnGroundManager } = core();
  const inventory = player.getInventory();
  if (amount === base || inventory.getAddableAmount(new Item(request.itemId, base)) < base) return;
  // The extras take only the room the pick itself leaves.
  const extras = amount - base;
  const inside = Math.min(extras, Math.max(0, inventory.getAddableAmount(new Item(request.itemId, amount)) - base));
  if (inside > 0) inventory.add(new Item(request.itemId, inside), true);
  if (extras > inside) ItemOnGroundManager.registers(player, new Item(request.itemId, extras - inside));
  request.amount = amount;
  request.stored = extras;
}

function planting(rules) {
  const percent = value(rules.player, "seedyBusiness");
  if (!rules.keepSeed && percent !== null && chance(percent)) rules.keepSeed = true;
}

// ---- Rock Solid, Homewrecker, Message In A Bottle ----

function keepRock(request) {
  if (request.handled || !effects().rockSolid.rocks.includes(request.rock)) return;
  const percent = value(request.player, "rockSolid");
  if (percent !== null && chance(percent)) request.handled = true;
}

function nestChance(request) {
  const times = value(request.player, "homewrecker");
  if (times !== null) request.multiplier *= times;
}

function nestDrop(request) {
  if (request.handled || value(request.player, "homewrecker") === null) return;
  if (!Common.bank(request.player, request.itemId, 1)) return;
  request.handled = true;
  request.player.sendMessage(data.messages.nestBanked);
}

function vesselChance(request) {
  const times = value(request.player, "messageInABottle");
  if (times !== null) request.multiplier *= times;
}

// ---- Catch Of The Day, Chinchonkers ----

/** `fishing:success`: a 1-in-N chance of one roll on the rare drop table (not a Fishing Trawler trip's reward). */
function rareCatch({ player, source }) {
  if (source === "fishing-trawler") return;
  const odds = value(player, "catchOfTheDay");
  if (odds === null || odds <= 0 || Math.random() * odds >= 1) return;
  const roll = { player, table: { entries: [{ shared_table: effects().catchOfTheDay.table, weight: 1 }] }, drops: [] };
  Common.api.emitCustomEvent("npc-drops:roll-table", roll);
  for (const drop of roll.drops) {
    const id = drop.noted ? Common.noted(drop.itemId) : drop.itemId;
    player.getInventory().forceAdd(player, new (core().Item)(id, drop.amount));
    const name = core().ItemDefinition.forId(drop.itemId)?.getName?.() ?? "something";
    player.sendMessage(data.messages.rareCatch.replace("{item}", name));
  }
}

function isChinchompa(npcId) {
  const name = core().NpcDefinition.forId(Number(npcId))?.getName?.() ?? "";
  return name.toLowerCase().includes(effects().chinchonkers.creature);
}

/** `hunter:rewards`: more Hunter XP for a chinchompa, and two of them from its third level. */
function chinchompas(request) {
  const percent = value(request.player, "chinchonkers");
  if (percent === null || !isChinchompa(request.npcId)) return;
  request.xp *= 1 + percent / 100;
  const effect = effects().chinchonkers;
  if (Fragments.equippedLevel(request.player, effect.fragment) >= effect.doubleFrom) {
    request.rewards = request.rewards.map(([id, count]) => [id, count * 2]);
  }
}

module.exports = function attach(api) {
  api.onCustomEvent("storage:gather", gather);
  api.onCustomEvent("storage:room", room);
  api.onCustomEvent("farming:pick", pick);
  api.onCustomEvent("farming:plant-rules", planting);
  api.onCustomEvent("mining:deplete-rock", keepRock);
  api.onCustomEvent("woodcutting:nest-chance", nestChance);
  api.onCustomEvent("woodcutting:nest-drop", nestDrop);
  api.onCustomEvent("treasure-trails:vessel-chance", vesselChance);
  api.onCustomEvent("fishing:success", rareCatch);
  api.onCustomEvent("hunter:rewards", chinchompas);
};

module.exports._test = { gather, room, pick, planting, keepRock, nestChance, nestDrop, vesselChance, rareCatch, chinchompas };
