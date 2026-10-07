/**
 * The dwarf multicannon (https://oldschool.runescape.wiki/w/Dwarf_multicannon), from an OSRS
 * capture of its whole life and the Wiki (docs/dwarf-cannon.md): setting it up, cannonballs,
 * turning and firing, decay and repair, Nulodion's replacements, restricted areas and the
 * ornament kit. Each lives in ./dwarfcannon/.
 */
const Cannon = require("./dwarfcannon/Common.DwarfCannon");

module.exports = {
  name: "DwarfCannon",
  members: true,
  register(api) {
    Cannon.init(api);
    require("./dwarfcannon/Setup.DwarfCannon")(api);
    require("./dwarfcannon/Ammo.DwarfCannon")(api);
    require("./dwarfcannon/Decay.DwarfCannon")(api);
    require("./dwarfcannon/Nulodion.DwarfCannon")(api);
    require("./dwarfcannon/Ornament.DwarfCannon")(api);
  },
};
