/**
 * The Ardougne Diary's pickpocketing rewards (docs/diary-rewards.md), answering the pickpocket's
 * "thieving:pickpocket-target" request:
 * - Medium: 10% more successful pickpockets of NPCs in Ardougne; Hard: the same 10% anywhere.
 *   Wiki: https://oldschool.runescape.wiki/w/Pickpocketing ("The Ardougne cloak doesn't need to be worn
 *   or carried"), https://oldschool.runescape.wiki/w/Ardougne_Diary.
 * - Medium / Hard / Elite: 56 / 84 / 140 coin pouches held at once, up from 28
 *   (https://oldschool.runescape.wiki/w/Coin_pouch).
 *
 * The Wiki words these as completing the tier, so a finished tier counts whether or not its reward was
 * claimed. INFERRED, not on the Wiki: the bonus scales the success chart as the gloves of silence and the
 * Thieving cape do, and "in Ardougne" is the East and West Ardougne city rectangle below (taken from where
 * the city's pickpocketable NPCs stand), judged by the NPC. The master farmer's patch north of the walls is
 * outside it.
 */
const DIARY = "ardougne";
const SUCCESS_BONUS_PERCENT = 10;
/** Highest finished tier first: its coin pouch limit wins. */
const POUCH_LIMITS = [["elite", 140], ["hard", 84], ["medium", 56]];
const ARDOUGNE_CITY = { minX: 2432, maxX: 2690, minY: 3262, maxY: 3336 };

let api;

function complete(player, tier) {
  const query = { player, diary: DIARY, tier, complete: false };
  api.emitCustomEvent("diary:is-complete", query);
  return query.complete === true;
}

function inArdougne(location) {
  return location.getX() >= ARDOUGNE_CITY.minX && location.getX() <= ARDOUGNE_CITY.maxX
    && location.getY() >= ARDOUGNE_CITY.minY && location.getY() <= ARDOUGNE_CITY.maxY;
}

function pickpocketTarget(request) {
  const { player, npc } = request;
  const limit = POUCH_LIMITS.find(([tier]) => complete(player, tier));
  if (limit) request.pouchLimit = Math.max(request.pouchLimit, limit[1]);
  if (complete(player, "hard") || (complete(player, "medium") && inArdougne(npc.getLocation()))) {
    request.chanceBonus = (request.chanceBonus | 0) + SUCCESS_BONUS_PERCENT;
  }
}

module.exports = function attachPickpocketing(pluginApi) {
  api = pluginApi;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
};
module.exports._test = { pickpocketTarget, inArdougne };
