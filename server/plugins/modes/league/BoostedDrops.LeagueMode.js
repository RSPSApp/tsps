/**
 * "Items from eligible sources will be Nx as common" (docs/leagues.md; the Wiki's Boosted drops
 * page of each league, data/league-boosted-drops.json; the rate by tier is leagues.json
 * `passives.dropRate`). A roller asks once per roll with the source's name and a list to fill:
 * NpcDrops `npc-drops:chance` { player, npc, npcId, source, rules } for a kill, and any other
 * roller `drops:chance` { player, source, rules } (superior Slayer monsters' uniques, Treasure
 * Trails caskets). The answer is one rule { pattern, multiplier } whose pattern matches the
 * names of that source's boosted items in the character's league, so a source listed twice never
 * stacks. A main character gets no rule.
 *
 * Minigames that already ask `minigame:chance` { player, minigame, kind, multiplier } for one
 * rare find (MINIGAME_FINDS) get the same rate when their source's row names that find: the
 * multiplier is multiplied, so a 1-in-n find is m-in-n.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.LeagueMode");
const Passives = require("./Passives.LeagueMode");

let data = null;
let sources = null;
let rollers = null;

/** A data name: `*` everything, `/.../` a regular expression, else the whole name; all without case. */
function matcher(text) {
  if (text === "*") return /.*/;
  if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) return new RegExp(text.slice(1, -1), "i");
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

function load() {
  if (sources) return;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "league-boosted-drops.json"), "utf8"));
  sources = data.sources.map((source) => ({
    name: matcher(source.name),
    npcs: (source.npcs ?? []).map(matcher),
    items: source.items.map(matcher),
    leagues: source.leagues ? new Set(source.leagues.map(Number)) : null,
  }));
  rollers = Object.fromEntries(Object.entries(data.rollers ?? {}).map(([key, roller]) => [key, roller.items.map(matcher)]));
}

/** The item patterns boosted for `source` (an NPC's name, a source's name or a roller's key) in league `type`. */
function patternsFor(type, source) {
  load();
  const name = String(source ?? "");
  const patterns = [];
  for (const entry of sources) {
    if (entry.leagues && !entry.leagues.has(type)) continue;
    if (entry.name.test(name) || entry.npcs.some((npc) => npc.test(name))) patterns.push(...entry.items);
  }
  if (Object.hasOwn(rollers, name)) patterns.push(...rollers[name]);
  return patterns;
}

/** The one rule for this roll, or null: the league's rate at the tier reached, on the source's boosted items. */
function rule(player, source) {
  const type = Common.leagueOf(player);
  if (type === null) return null;
  const multiplier = Passives.tierValue(player, "dropRate");
  if (!multiplier || multiplier <= 1) return null;
  const patterns = patternsFor(type, source);
  if (patterns.length === 0) return null;
  return { pattern: { test: (name) => patterns.some((pattern) => pattern.test(String(name ?? ""))) }, multiplier };
}

/**
 * The `minigame:chance` finds that are a Boosted drops row: `minigame:kind` to the row's source
 * name and the find's item name.
 */
const MINIGAME_FINDS = Object.freeze({
  "pyramid-plunder:pharaohs-sceptre": { source: "Pyramid plunder", item: "Pharaoh's sceptre" },
  "hallowed-sepulchre:ring-of-endurance": { source: "Grand Hallowed Coffin", item: "Ring of endurance" },
  "fishing-trawler:angler-outfit": { source: "Fishing Trawler", item: "Angler's hat" },
  "tai-bwo-wannai-cleanup:gout-tuber": { source: "Tai Bwo Wannai Cleanup", item: "Gout tuber" },
  "aerial-fishing:golden-tench": { source: "Aerial fishing", item: "Golden tench" },
});

/** `minigame:chance` { player, minigame, kind, multiplier }: a boosted find's multiplier, times the rate. */
function answerMinigameChance(request) {
  if (!request?.player) return;
  const find = MINIGAME_FINDS[`${request.minigame}:${request.kind}`];
  if (!find) return;
  const boost = rule(request.player, find.source);
  if (!boost || !boost.pattern.test(find.item)) return;
  request.multiplier = (Number(request.multiplier) || 1) * boost.multiplier;
}

/** `npc-drops:chance` and `drops:chance` { player, source, rules }: the league's rule joins the roll. */
function answerChance(request) {
  if (!request?.player || !Array.isArray(request.rules)) return;
  const boost = rule(request.player, request.source);
  if (boost) request.rules.push(boost);
}

module.exports = function attach(api) {
  api.onCustomEvent("npc-drops:chance", answerChance);
  api.onCustomEvent("drops:chance", answerChance);
  api.onCustomEvent("minigame:chance", answerMinigameChance);
};

module.exports.rule = rule;
module.exports.patternsFor = patternsFor;
module.exports.MINIGAME_FINDS = MINIGAME_FINDS;
