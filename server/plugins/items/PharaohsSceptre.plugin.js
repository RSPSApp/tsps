/**
 * The Pharaoh's sceptre (https://oldschool.runescape.wiki/w/Pharaoh%27s_sceptre), from
 * plugins/items/data/pharaohs-sceptre.json: its teleports to the great pyramids, its charges and
 * the Desert Diary's larger capacities, and recharging at the guardian mummy. Pyramid Plunder
 * (plugins/minigames/PyramidPlunder.plugin.js) finds it. Each part lives in ./pharaohssceptre/.
 */
const Common = require("./pharaohssceptre/Common.PharaohsSceptre");
const Teleport = require("./pharaohssceptre/Teleport.PharaohsSceptre");
const Recharge = require("./pharaohssceptre/Recharge.PharaohsSceptre");

module.exports = {
  name: "PharaohsSceptre",
  description: "Adds the Pharaoh's sceptre: teleports to the great pyramids, charges, Desert Diary capacity and recharging at the guardian mummy.",
  members: true,
  register(api) {
    Common.init(api);
    for (const attribute of [Common.CHARGES_ATTRIBUTE, Common.LAST_ATTRIBUTE]) api.persistAttribute(attribute, 0);
    for (const attribute of [Common.NECROPOLIS_ATTRIBUTE, Common.MUMMY_MET_ATTRIBUTE]) api.persistAttribute(attribute, false);
    Teleport.attach(api);
    Recharge.attach(api);
    api.onPlayerLogin(({ player }) => Common.sync(player));
  },
};
