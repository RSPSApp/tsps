/**
 * TzHaar-Ket-Rak's Challenges (https://oldschool.runescape.wiki/w/TzHaar-Ket-Rak%27s_Challenges),
 * from plugins/minigames/data/tzhaar-ket-rak.json: TzHaar-Ket-Rak's talk and challenge menu, the
 * challenges against one to six JalTok-Jads, their rewards and the scoreboard. Each lives in ./tzhaarketrak/.
 */
const Common = require("./tzhaarketrak/Common.TzHaarKetRak");
const Dialogue = require("./tzhaarketrak/Dialogue.TzHaarKetRak");
const Challenge = require("./tzhaarketrak/Challenge.TzHaarKetRak");
const Rewards = require("./tzhaarketrak/Rewards.TzHaarKetRak");
const Scoreboard = require("./tzhaarketrak/Scoreboard.TzHaarKetRak");
const EscapeCrystal = require("./tzhaarketrak/EscapeCrystal.TzHaarKetRak");

/** Playable encounter IDs, read without starting a run or rolling rewards. */
function describeEncounters({ npcIds }) {
  npcIds.add(Common.ids.npcs.jad);
  npcIds.add(Common.ids.npcs.healer);
}

module.exports = {
  name: "TzHaarKetRak",
  description: "Adds TzHaar-Ket-Rak's Challenges: fights against one to six JalTok-Jads, their rewards and a scoreboard.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    Common.init(api);
    Dialogue.attach(api, { start: Challenge.start });
    Challenge.attach(api, { lastJadDown: Rewards.lastJadDown, completed: Rewards.completed, failed: Rewards.failed, refused: Rewards.refused });
    Rewards.attach(api);
    Scoreboard.attach(api);
    EscapeCrystal.attach(api);
  },
};
