/**
 * Champions' Challenge (https://oldschool.runescape.wiki/w/Champions%27_Challenge), from
 * plugins/minigames/data/champions-challenge.json, as captured and from the Wiki: the Champions'
 * Guild basement (a copy per player), Larxus and the champions' scrolls, the ten champions and
 * Leon d'Cour with their rules, the kills' XP, the Chest of Champions and its lamps, the cape,
 * and which kills drop a scroll. Each lives in ./championschallenge/. See
 * docs/champions-challenge.md.
 */
const Common = require("./championschallenge/Common.ChampionsChallenge");
const Gallery = require("./championschallenge/Gallery.ChampionsChallenge");
const Larxus = require("./championschallenge/Larxus.ChampionsChallenge");
const Rules = require("./championschallenge/Rules.ChampionsChallenge");
const Combat = require("./championschallenge/Combat.ChampionsChallenge");
const Rewards = require("./championschallenge/Rewards.ChampionsChallenge");

/** Playable encounter IDs, read without starting a run or rolling rewards. */
function describeEncounters({ npcIds }) {
  for (const champion of Common.DATA.champions) npcIds.add(champion.npc);
}

module.exports = {
  name: "ChampionsChallenge",
  description: "Adds the Champions' Challenge: Larxus and the champions' scrolls, the ten champions in the Guild basement, Leon d'Cour and the Chest of Champions.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    Common.init(api);
    Gallery.attachGallery(api);
    Larxus.attachLarxus(api);
    Rules.attachRules(api);
    Combat.attachCombat(api);
    Rewards.attachRewards(api);
  },
};
