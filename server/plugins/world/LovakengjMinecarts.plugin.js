/**
 * The Lovakengj Minecart Network (https://oldschool.runescape.wiki/w/Lovakengj_Minecart_Network),
 * from plugins/world/data/lovakengj-minecarts.json: twelve stations across Great Kourend and the
 * Kebos Lowlands, 20 coins a ride until The Forsaken Tower makes them free. The units are in
 * ./lovakengjminecarts/.
 */
const Common = require("./lovakengjminecarts/Common.LovakengjMinecarts");
const Travel = require("./lovakengjminecarts/Travel.LovakengjMinecarts");

module.exports = {
  name: "LovakengjMinecarts",
  members: true,
  register(api) {
    Common.init(api);
    Travel.attach(api);
  },
};
