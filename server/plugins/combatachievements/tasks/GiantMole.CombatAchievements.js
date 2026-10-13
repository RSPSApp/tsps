/** The Giant Mole's fight. */
const HARD_HITTER_HITS = 4;

module.exports = function attachGiantMoleTasks(_api, Fights) {
  Fights.onKill("Giant Mole", {
    "Hard Hitter": (fight) => fight.dealt.filter((hit) => hit.damage > 0).length <= HARD_HITTER_HITS,
    "Avoiding Those Little Arms": (fight) => fight.damageTaken() === 0,
  });
};
