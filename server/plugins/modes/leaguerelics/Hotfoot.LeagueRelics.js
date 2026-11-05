/**
 * Hotfoot (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 2
 * relic. With the Searing boots (from the cache's relic struct) worn, caught fish come cooked and
 * mined ore comes smelted into its own bar, with the Cooking or Smithing XP (ours: the Wiki gives
 * none; anything with no recipe of its own stays as it is). Iron ore comes as a steel bar with a
 * steel bar's 17.5 XP (`oreBars`; 234/03285: 133 iron mined banked 133 steel bars, Smithing drops
 * of 262/263 at 15x, mithril ore gave mithril bars and coal stayed coal). Whether coal is used up
 * for the steel can't be seen there; we take none. Whatever the footwear,
 * Agility and Cooking never fail, a lap counts twice and pays 25% more experience, a mark of grace
 * on a rooftop course is a 33% chance a lap (`agility:mark-chance`, in place of the course's own
 * and its overlevel cut; the 3-minute mark cooldown still runs: ours), and a course mark picked up
 * finishes a lap of its course, paid as one, with 10,000 coins (`agility:mark-taken`). Prifddinas's
 * portal shards come tenfold (`agility:course-item`) and the Brimhaven Agility Arena's tickets and
 * vouchers twofold (`minigame:points`, after the tier passive's: the Wiki's 16 a pillar at 8x).
 *
 * The processing hears `storage:gather` twice: first (attached before the other gathering
 * relics) it swaps the request's item for the cooked fish or bar, so a relic that banks or
 * doubles the harvest (Endless Harvest) handles the processed item; last, it hands what nobody
 * stored to the inventory in place of the raw item.
 * Running in the boots pays Agility XP (Wiki, Searing boots): 10 + floor(Agility level x 2/3) for
 * every 10 ticks in which the player moved 2 tiles (a run step; a diagonal pair around an object
 * nets less and doesn't count), before the league's rates; the base level, and the count kept
 * across stops, are ours ("roughly every 10 ticks"). A tick task per owner, from login or the
 * unlock, watches the tile.
 * Not here: termites finishing a lap or doubled (the Colossal
 * Wyrm courses give no termites: their spawn rate is unknown, the Wiki says, and its course page
 * is marked out of date).
 */
const Common = require("./Common.LeagueRelics");

let api;
let core;
let effect;
/** Ores smelted into a bar other than their own (iron into steel): ore id -> bar id. */
let oreBars;

/** Gathers being processed: request -> the raw item it replaced. */
const processing = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function wearsBoots(player) {
  return active(player) && player.getEquipment().contains(core.ItemIdentifiers[effect.tool]);
}

/** The cooked fish or the bar, with its skill and XP; null when the item has none. */
function processed(skill, itemId) {
  if (skill === core.Skill.FISHING) {
    const cooked = { rawId: itemId, cookedId: null, xp: null };
    api.emitCustomEvent("cooking:cooked", cooked);
    return cooked.cookedId ? { itemId: cooked.cookedId, skill: core.Skill.COOKING, xp: cooked.xp } : null;
  }
  if (skill === core.Skill.MINING) {
    const bar = { oreId: itemId, outputId: oreBars.get(itemId) ?? null, barId: null, xp: null };
    api.emitCustomEvent("smithing:bar-for-ore", bar);
    return bar.barId ? { itemId: bar.barId, skill: core.Skill.SMITHING, xp: bar.xp } : null;
  }
  return null;
}

function process(request) {
  const { player, amount } = request;
  if (request.stored >= amount || !wearsBoots(player)) return;
  const result = processed(request.skill, request.itemId);
  if (!result) return;
  processing.set(request, request.itemId);
  request.itemId = result.itemId;
  if (result.xp > 0) player.getSkillManager().addExperiences(result.skill, result.xp * (amount - request.stored));
}

/** What nobody stored goes to the inventory as the processed item, in the raw item's place. */
function deliver(request) {
  if (!processing.has(request)) return;
  processing.delete(request);
  const left = request.amount - request.stored;
  if (left <= 0) return;
  request.player.getInventory().adds(request.itemId, left);
  request.stored = request.amount;
}

function succeeds(request) {
  if (active(request.player)) request.success = true;
}

function neverBurns(request) {
  if (active(request.player)) request.burn = false;
}

function lapReward(request) {
  if (!active(request.player)) return;
  request.count = Math.max(request.count, effect.lapCount);
  request.xp *= effect.lapXpMultiplier;
}

function markChance(request) {
  if (active(request.player) && effect.markCourses.includes(request.course)) request.chance = effect.markChance;
}

function markTaken(request) {
  if (!active(request.player)) return;
  request.completesLap = true;
  request.items.push([core.ItemIdentifiers.COINS, effect.markLapCoins]);
}

/** Prifddinas's portal shards, tenfold. */
function courseItem(request) {
  const items = effect.courseItems[request.course];
  const name = items && Object.keys(items).find((key) => core.ItemIdentifiers[key] === request.itemId);
  if (name && active(request.player)) request.amount *= items[name];
}

/** The Brimhaven Agility Arena's tickets and vouchers, twofold. */
function minigamePoints(request) {
  const multiplier = effect.minigamePoints?.[request.minigame];
  if (multiplier && active(request.player)) request.points *= multiplier;
}

/** Owners whose run is being watched: their last tile and the run ticks counted. */
const runners = new WeakMap();

/** One tick of an owner's run: a 2-tile move in the boots counts; every 10th pays. */
function runTick(player) {
  const watch = runners.get(player);
  const here = player.getLocation();
  const moved = watch.last && watch.last.getZ() === here.getZ()
    && Math.max(Math.abs(here.getX() - watch.last.getX()), Math.abs(here.getY() - watch.last.getY())) === effect.runStepTiles;
  watch.last = here.clone();
  if (!moved || !wearsBoots(player)) return;
  if (++watch.ticks < effect.runXpTicks) return;
  watch.ticks = 0;
  const level = player.getSkillManager().getMaxLevel(core.Skill.AGILITY);
  player.getSkillManager().addExperiences(core.Skill.AGILITY, effect.runXpBase + Math.floor((level * effect.runXpLevelFraction[0]) / effect.runXpLevelFraction[1]));
}

function watchRuns(player) {
  if (runners.has(player) || !active(player)) return;
  runners.set(player, { last: null, ticks: 0 });
  const next = () => core.TaskManager.submit(new core.CountdownTask(player, 1, () => {
    if (!player.isRegistered?.() || !active(player)) {
      runners.delete(player);
      return;
    }
    runTick(player);
    next();
  }));
  next();
}

function watchFromEvent({ player }) {
  watchRuns(player);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.hotfoot;
  oreBars = new Map(Object.entries(effect.oreBars).map(([ore, bar]) => [core.ItemIdentifiers[ore], core.ItemIdentifiers[bar]]));
  api.onCustomEvent("storage:gather", process);
  api.onCustomEvent("agility:roll", succeeds);
  api.onCustomEvent("cooking:burn", neverBurns);
  api.onCustomEvent("agility:lap-reward", lapReward);
  api.onCustomEvent("agility:mark-chance", markChance);
  api.onCustomEvent("agility:mark-taken", markTaken);
  api.onCustomEvent("agility:course-item", courseItem);
  api.onCustomEvent("minigame:points", minigamePoints);
  api.onCustomEvent("league:login", watchFromEvent);
  api.onCustomEvent("league:relic-unlocked", watchFromEvent);
};

module.exports.runTick = runTick;
module.exports.watchRuns = watchRuns;
module.exports.runners = runners;

/** The last `storage:gather` listener: attached after every other gathering relic. */
module.exports.late = function attachLate(pluginApi) {
  pluginApi.onCustomEvent("storage:gather", deliver);
};
