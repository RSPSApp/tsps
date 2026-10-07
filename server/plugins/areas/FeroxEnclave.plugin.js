/**
 * Ferox Enclave (https://oldschool.runescape.wiki/w/Ferox_Enclave), from OSRS captures
 * (docs/ferox-enclave.md): the barriers and safe ground, the Pools of Refreshment, and the Clan
 * Wars free-for-all arena behind the white portal. Each lives in ./ferox/.
 */
const Ferox = require("./ferox/Common.FeroxEnclave");

module.exports = {
  name: "FeroxEnclave",
  register(api) {
    Ferox.init(api);
    require("./ferox/Barriers.FeroxEnclave")(api);
    require("./ferox/Pool.FeroxEnclave")(api);
    require("./ferox/FreeForAll.FeroxEnclave")(api);
  },
};
