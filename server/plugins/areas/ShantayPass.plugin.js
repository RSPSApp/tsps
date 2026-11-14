/**
 * The Shantay Pass (https://oldschool.runescape.wiki/w/Shantay_Pass): the gate into the desert,
 * Shantay and his pass, and his jail. Behaviour is from rsprox captures (docs/shantay-pass.md).
 */
const Common = require("./shantaypass/Common.ShantayPass");

module.exports = {
  name: "ShantayPass",
  description: "Shantay Pass: the gate into the desert, Shantay and his pass, his jail, and the passes the Ruins of Unkah guards sell.",
  register(api) {
    Common.init(api);
    require("./shantaypass/Gate.ShantayPass")(api);
    require("./shantaypass/Shantay.ShantayPass")(api);
    require("./shantaypass/Jail.ShantayPass")(api);
    require("./shantaypass/UnkahGuard.ShantayPass")(api);
  },
};
