/**
 * Yama (https://oldschool.runescape.wiki/w/Yama), from plugins/bosses/data/yama.json, as captured
 * at the bottom of the Chasm of Fire: the Voice of Yama, Yama's Domain (an instance of the
 * player's own), Yama on his throne with his contract, the fight's three phases with the Judge
 * of Yama between them, and the loot. Each part lives in ./yama/.
 * Solo only, and open to all: A Kingdom Divided isn't asked for. See docs/yama.md.
 */
const Common = require("./yama/Common.Yama");
const Domain = require("./yama/Domain.Yama");
const Voice = require("./yama/Voice.Yama");
const Throne = require("./yama/Throne.Yama");
const Fight = require("./yama/Fight.Yama");
const Flares = require("./yama/Flares.Yama");
const Judge = require("./yama/Judge.Yama");
const Lockbox = require("./yama/Lockbox.Yama");

module.exports = {
  name: "Yama",
  members: true,
  register(api) {
    Common.init(api);
    Domain.attachDomain(api);
    Voice.attachVoice(api);
    Throne.attachThrone(api);
    Fight.attachFight(api);
    Flares.attachFlares(api);
    Judge.attachJudge(api);
    Lockbox.attachLockbox(api);
    require("./yama/Commands.Yama")(api);
  },
};
