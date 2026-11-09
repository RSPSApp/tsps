/**
 * Ecumenical keys from the Wilderness God Wars Dungeon's monsters (Wiki, Ecumenical key):
 * - "While all monsters within the Wilderness God Wars Dungeon can drop the ecumenical key"; "The base drop rate of
 *   the ecumenical key is 1/60"; the hard, elite, master and grandmaster Combat Achievement tiers "increases this to
 *   1/55, 1/50, 1/45, and 1/40 respectively".
 * - "Players are limited to having three (3) keys at a time"; the Medium and Hard Wilderness Diary raise it to four
 *   and five. A key past the limit is deleted, with "You already have enough of these". Keys counted: carried and
 *   banked, as the Nex shard combining counts them.
 * Recorded: rsprox_transcripts/224/01463.txt:137735, a godwars_ancient_imp (3134) dropping one at (3041, 10144, 0).
 */
const Common = require("./Common.GodWars");

/** The dungeon's spawns' extent (x 3018-3054, y 10118-10163) with a margin, as the Wilderness Diary has it. */
const DUNGEON = { minX: 3010, maxX: 3065, minY: 10110, maxY: 10170 };
const BASE_RATE = 60;
const CA_RATES = [["Grandmaster", 40], ["Master", 45], ["Elite", 50], ["Hard", 55]];
const ENOUGH = "You already have enough of these";
// rsprox_transcripts/224/01463.txt:137735: sent with the drop, as other untradeable drops are.
const UNTRADEABLE_DROP = "<col=ef1020>Untradeable drop: Ecumenical key</col>";

function inDungeon(npc) {
  const at = npc?.getLocation?.();
  if (!at || at.getZ() !== 0) return false;
  return at.getX() >= DUNGEON.minX && at.getX() <= DUNGEON.maxX && at.getY() >= DUNGEON.minY && at.getY() <= DUNGEON.maxY;
}

function tierClaimed(player, tier) {
  const request = { player, tier, claimed: false, currentThresholdMet: false };
  Common.api.emitCustomEvent("combat-achievements:tier", request);
  return request.claimed === true && request.currentThresholdMet === true;
}

function dropRate(player) {
  return CA_RATES.find(([tier]) => tierClaimed(player, tier))?.[1] ?? BASE_RATE;
}

function diaryDone(player, tier) {
  const request = { player, diary: "wilderness", tier, complete: false };
  Common.api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function keyLimit(player) {
  if (diaryDone(player, "hard")) return 5;
  if (diaryDone(player, "medium")) return 4;
  return 3;
}

function keysHeld(player) {
  const id = Common.core.ItemIdentifiers.ECUMENICAL_KEY;
  let count = player.getInventory().getAmount(id);
  for (const tab of player.getBanks?.() ?? []) count += tab?.getAmount?.(id) ?? 0;
  return count;
}

/** "npc-drops:add": a key for a kill in the dungeon, unless the player already holds their limit. */
function addKey(event) {
  const { player, npc, drops } = event;
  if (!player || !Array.isArray(drops) || !inDungeon(npc)) return;
  if (Math.floor(Math.random() * dropRate(player)) !== 0) return;
  if (keysHeld(player) >= keyLimit(player)) {
    player.sendMessage(ENOUGH);
    return;
  }
  drops.push({ itemId: Common.core.ItemIdentifiers.ECUMENICAL_KEY, amount: 1 });
  player.sendMessage(UNTRADEABLE_DROP);
}

function attachKeys(api) {
  api.onCustomEvent("npc-drops:add", addKey);
}

module.exports = { attachKeys, _test: { addKey, dropRate, keyLimit, inDungeon, DUNGEON } };
