/**
 * The Giant Mole's fight. Her burrows, last resurfacing and death are kept on the NPC by
 * GiantMole.plugin.js, one life at a time.
 */
const { BURROWS_ATTRIBUTE, SURFACED_TICK_ATTRIBUTE, DIED_TICK_ATTRIBUTE } = require("../../../bosses/GiantMole.plugin");

const HARD_HITTER_HITS = 4;
/** "Kill the Giant Mole without her burrowing more than 2 times." */
const MOST_BURROWS = 2;
/** "Kill the Giant Mole within 10 seconds of her resurfacing." 0.6 s a tick. */
const WHACK_SECONDS = 10;

const burrows = (npc) => npc?.getAttribute?.(BURROWS_ATTRIBUTE) ?? 0;

/** She came up at least once, and died no more than 10 seconds after she last did. */
function killedSoonAfterSurfacing(npc) {
  const surfaced = npc?.getAttribute?.(SURFACED_TICK_ATTRIBUTE);
  const died = npc?.getAttribute?.(DIED_TICK_ATTRIBUTE);
  if (!Number.isFinite(surfaced) || !Number.isFinite(died) || died < surfaced) return false;
  return (died - surfaced) * 0.6 <= WHACK_SECONDS;
}

module.exports = function attachGiantMoleTasks(_api, Fights) {
  Fights.onKill("Giant Mole", {
    "Hard Hitter": (fight) => fight.dealt.filter((hit) => hit.damage > 0).length <= HARD_HITTER_HITS,
    "Avoiding Those Little Arms": (fight) => fight.damageTaken() === 0,
    "Why Are You Running?": (fight) => burrows(fight.npc) <= MOST_BURROWS,
    "Whack-a-Mole": (fight) => killedSoonAfterSurfacing(fight.npc),
  });
};

module.exports._test = { burrows, killedSoonAfterSurfacing, MOST_BURROWS, WHACK_SECONDS };
