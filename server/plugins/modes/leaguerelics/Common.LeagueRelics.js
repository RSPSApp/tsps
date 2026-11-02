/**
 * Shared by the LeagueRelics units: the data (league-relics.json, plus leagues.json for each
 * league's name, colour and unlock graphic), a character's league (LeagueMode's `league:profile`),
 * its chosen relics and points, and the catalog lookups.
 */
const fs = require("fs");
const path = require("path");

/** Chosen relics: tier index (0-7) -> slot (1-3). */
const RELICS_ATTRIBUTE = "league:relics";

let api = null;
let core = null;
let data = null;
let leagues = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const dir = path.join(__dirname, "..", "data");
  data = JSON.parse(fs.readFileSync(path.join(dir, "league-relics.json"), "utf8"));
  leagues = JSON.parse(fs.readFileSync(path.join(dir, "leagues.json"), "utf8")).leagues;
}

/** The league a character is in (its type), or null for a main character. */
function leagueOf(player) {
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  const type = query.league;
  return type !== null && data.leagues[type] && leagues[type] ? Number(type) : null;
}

/** Catalogs built from the cache (data `fromCache`), by league type. */
const cacheCatalogs = new Map();

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function enumEntries(id) {
  return [...core.CacheDefinitions.getEnumValues(id).entries()].sort(([a], [b]) => a - b);
}

/**
 * The current league's catalog as the cache holds it: the league struct's tier enum, each tier's
 * cost, passive struct and relic enum, each relic's name and description (the params the relic
 * interface reads). A relic struct naming an item (Demonic Pacts' `relicItemParam`, 2049) hands
 * it out, and like every item relic is unlocked in a bank (the captured rule, 237/01102).
 */
function catalogFromCache(type) {
  const { params } = data;
  const { CacheDefinitions } = core;
  const leagueParams = CacheDefinitions.getStructParams(league(type).struct);
  const itemParam = cacheLeague(type)?.relicItemParam;
  const tiers = enumEntries(leagueParams.get(params.tiersEnum)).map(([, tierStruct]) => {
    const tierParams = CacheDefinitions.getStructParams(tierStruct);
    const passiveStruct = tierParams.get(params.tierPassive);
    const relics = enumEntries(tierParams.get(params.tierRelics)).map(([, relicStruct]) => {
      const relicParams = CacheDefinitions.getStructParams(relicStruct);
      const name = String(relicParams.get(params.relicName) ?? "");
      const item = itemParam === undefined ? undefined : relicParams.get(itemParam);
      const grants = Number.isInteger(item) && item > 0 ? [item] : [];
      return {
        key: slug(name), name, description: String(relicParams.get(params.relicDescription) ?? ""),
        grants, requiresBank: grants.length > 0, struct: relicStruct,
      };
    });
    return {
      cost: Number(tierParams.get(params.tierCost)) || 0,
      passive: String(CacheDefinitions.getStructParams(passiveStruct)?.get(params.passiveText) ?? ""),
      relics, struct: tierStruct, passiveStruct,
    };
  });
  return { fromCache: true, tiers };
}

/** The effects entry describing a cache-read league (Demonic Pacts' `demonicPacts`), or null. */
function cacheLeague(type) {
  return Object.values(data.effects).find((entry) => entry?.cacheLeague === true && [].concat(entry.league).includes(Number(type))) ?? null;
}

/** A league's tiers and relics: the data's, or the cache's own for a league marked `fromCache`. */
function catalog(type) {
  const row = data.leagues[type];
  if (!row) return null;
  if (!row.fromCache) return row;
  if (!cacheCatalogs.has(type)) cacheCatalogs.set(type, catalogFromCache(type));
  return cacheCatalogs.get(type);
}

/** The struct ids the relic interface's scripts take for a relic and its tier's passive. */
function structIds(type, tier, slot) {
  const tierRow = catalog(type)?.tiers[tier];
  if (tierRow?.struct !== undefined) {
    return { relicStruct: tierRow.relics[slot - 1]?.struct, passiveStruct: tierRow.passiveStruct };
  }
  const id = ids(type);
  return { relicStruct: id.relicStruct(tier, slot), passiveStruct: id.passiveStruct(tier) };
}

function league(type) {
  return leagues[type] ?? null;
}

function relic(type, tier, slot) {
  return catalog(type)?.tiers[tier]?.relics[slot - 1] ?? null;
}

function chosen(player) {
  const value = player.getAttribute(RELICS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function points(player) {
  const query = { player, points: 0, tasks: 0 };
  api.emitCustomEvent("league:points", query);
  return query.points | 0;
}

/** The highest tier index chosen, or -1. */
function highestTier(player) {
  return Object.keys(chosen(player)).reduce((highest, tier) => Math.max(highest, Number(tier)), -1);
}

/** Whether the character chose relic `key` in its own league's catalog. */
function hasRelic(player, key) {
  const type = leagueOf(player);
  if (type === null) return false;
  const picks = chosen(player);
  if (catalog(type).tiers.some((tier, tierIndex) => tier.relics[picks[tierIndex] - 1]?.key === key)) return true;
  return reloadedPick(player, type, picks)?.key === key;
}

/** The extra pick Reloaded gives (Raging Echoes' tier 4): { tier, slot } saved beside the tiers' picks. */
const RELOADED_ATTRIBUTE = "league:relics-extra";

/** The tiers Reloaded's extra pick may come from in a league: the league's own (`leagueTiers`), else `tiers`. */
function reloadedTiers(effect, type) {
  return effect.leagueTiers?.[type] ?? effect.tiers;
}

/** The relic of the extra pick, while the character holds Reloaded itself; else null. */
function reloadedPick(player, type = leagueOf(player), picks = chosen(player)) {
  const effect = data.effects.reloaded;
  if (!effect || ![].concat(effect.league).includes(type)) return null;
  const holds = catalog(type).tiers.some((tier, tierIndex) => tier.relics[picks[tierIndex] - 1]?.key === effect.key);
  const extra = player.getAttribute(RELOADED_ATTRIBUTE);
  if (!holds || !extra || !reloadedTiers(effect, type).includes(extra.tier)) return null;
  return relic(type, extra.tier, extra.slot);
}

/**
 * An effect applies to a player character in one of the effect's leagues (`league`: a type, or
 * several for a relic both leagues have) who chose its relic (`key`, or one of its `aliases`).
 */
function effectActive(player, effect) {
  if (player?.isPlayer?.() !== true) return false;
  const league = leagueOf(player);
  if (league === null || ![].concat(effect.league).includes(league)) return false;
  return [effect.key, ...(effect.aliases ?? [])].some((key) => hasRelic(player, key));
}

/** Virtual struct and enum ids for a league's catalog: the client reads them as if from the cache. */
function ids(type) {
  const base = data.virtualIdBase + Number(type) * 1000;
  return {
    tiersEnum: base,
    tierStruct: (tier) => base + 10 + tier,
    passiveStruct: (tier) => base + 20 + tier,
    relicsEnum: (tier) => base + 30 + tier,
    relicStruct: (tier, slot) => base + 100 + tier * 3 + (slot - 1),
  };
}

/** True while a relic builds a hit derived from another (a splash), so relics that scale hits leave it alone. */
let buildingDerivedHit = false;

/** Runs `build` (which constructs a PendingHit) as a derived hit; see `isBuildingDerivedHit`. */
function derivedHit(build) {
  buildingDerivedHit = true;
  try {
    return build();
  } finally {
    buildingDerivedHit = false;
  }
}

function isBuildingDerivedHit() {
  return buildingDerivedHit;
}

/** The attacker's max hit as combat computes it for a hit (the formulas, the ranged modifiers, a spell's bounds). */
function maxHitFor(attacker, target, combatType) {
  const { CombatType, DamageFormulas, PluginManager } = core;
  if (combatType === CombatType.MAGIC) return DamageFormulas.sourceHitBounds(attacker, combatType, target).maximum;
  const max = DamageFormulas.sourceMaxHit(attacker, combatType);
  return combatType === CombatType.RANGED ? PluginManager.modifyRangedMaxHit(attacker, target, max) : max;
}

/** Whether the bank would take this item (a free slot, or a stack of it already). */
function bankHasRoom(player, itemId) {
  const container = player.getBank(core.Bank.getTabForItem(player, itemId));
  return container.getFreeSlots() > 0 || container.contains(itemId);
}

/** Puts a gathered item straight in the bank when it has room; false leaves it with the player. */
function bank(player, itemId, amount) {
  if (amount <= 0 || !bankHasRoom(player, itemId)) return false;
  player.getBank(core.Bank.getTabForItem(player, itemId)).add(new core.Item(itemId, amount), true);
  return true;
}

/** The item's noted form, or the item itself when it has none. */
function noted(itemId) {
  const definition = core.ItemDefinition.forId(itemId);
  // A note's own link leads back to the item: a note is already noted.
  if (definition?.isNoted?.()) return itemId;
  const note = definition?.getNoteId?.() ?? -1;
  return note > 0 ? note : itemId;
}

/** Whether more than one of the item can sit in one slot: it stacks, or it has a note. */
function multipliable(itemId) {
  return noted(itemId) !== itemId || core.ItemDefinition.forId(itemId)?.isStackable?.() === true;
}

/**
 * Pickpocket loot multiplied `times` and noted (league relics): coins come as coin pouches, so each
 * copy is another pouch; a clue, and an item that neither stacks nor notes, stay as they are (Wiki:
 * Dodgy Deals, "unstackable/unnotable items are not multiplied").
 */
function multipliedLoot(loot, times) {
  const out = [];
  for (const entry of loot) {
    if (entry.clue || !multipliable(entry.id)) {
      out.push(entry);
    } else if (entry.id === core.ItemIdentifiers.COINS) {
      for (let copy = 0; copy < times; copy++) out.push({ ...entry });
    } else {
      out.push({ ...entry, id: noted(entry.id), amount: entry.amount * times });
    }
  }
  return out;
}

/** A potion or an unfinished one, by its name ("Attack potion(3)", "Guam potion (unf)"). */
function isPotion(itemId) {
  const name = core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
  return /\(\d\)$/.test(name) || /\(unf\)$/i.test(name) || /^vial of water$/i.test(name);
}

/** Whether a potion recipe's secondary (its ingredient that is not a potion or a vial) stacks: the production relics leave those alone (Wiki). */
function hasStackableSecondary(recipe) {
  return (recipe?.ingredients ?? []).some(({ id }) => !isPotion(id) && core.ItemDefinition.forId(id)?.isStackable?.() === true);
}

/**
 * A production relic's answer to `skills:actions-per-cycle`: the loop's kind in the relic's
 * `batch` list for that skill makes up to `maxActions` at once (a capped kind, `capped`), else
 * nothing changes. A potion with a stackable secondary is made one at a time.
 */
function batchActions(effect, request) {
  const skill = Object.keys(effect.batch).find((name) => core.Skill[name] === request.skill);
  if (!skill || !effect.batch[skill].includes(request.kind)) return null;
  if (request.kind === "mix" && hasStackableSecondary(request.recipe)) return null;
  return effect.capped?.[request.kind] ?? effect.maxActions;
}

/** Restores special attack energy and redraws the bar. */
function restoreSpecial(player, percent) {
  player.incrementSpecialPercentage(percent);
  core.CombatSpecial.updateBar(player);
}

/** A message's text; a cache-read league's own wording (its entry's `messages`) wins for its characters. */
function message(key, values = {}, type = null) {
  const own = type === null ? undefined : cacheLeague(type)?.messages?.[key];
  return (own ?? data.messages[key].text).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

module.exports = {
  init, leagueOf, catalog, league, relic, chosen, points, highestTier, hasRelic, effectActive, reloadedPick,
  RELOADED_ATTRIBUTE, reloadedTiers, cacheLeague, slug, ids, message, maxHitFor, restoreSpecial, bankHasRoom, bank, noted, multipliable,
  multipliedLoot, isPotion, hasStackableSecondary, batchActions, derivedHit, isBuildingDerivedHit,
  RELICS_ATTRIBUTE, structIds,
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
