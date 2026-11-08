/**
 * Zalcano (https://oldschool.runescape.wiki/w/Zalcano), from plugins/bosses/data/zalcano.json: her
 * prison under Prifddinas and its platforms and barrier, the shared fight with its armour,
 * fall and hazards, the tephra the players mine, refine, imbue and throw, and the contribution
 * rewards. Each lives in ./zalcano/.
 */
const Common = require("./zalcano/Common.Zalcano");
const Prison = require("./zalcano/Prison.Zalcano");

module.exports = {
  name: "Zalcano",
  description: "Zalcano under Prifddinas: the platforms and barrier, the shared fight, mining, refining, imbuing and throwing tephra, and contribution rewards.",
  members: true,
  register(api) {
    Common.init(api);
    Prison.attach(api);
  },
};
