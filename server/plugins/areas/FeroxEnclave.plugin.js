/**
 * Ferox Enclave (https://oldschool.runescape.wiki/w/Ferox_Enclave), from OSRS captures
 * (docs/ferox-enclave.md): the barriers and safe ground, the Pools of Refreshment, and the Clan
 * Wars free-for-all arena behind the white portal. Each lives in ./ferox/.
 */
const Ferox = require("./ferox/Common.FeroxEnclave");
const { isInsideEnclave } = require("./ferox/Bounds.FeroxEnclave");

function allowRandomEvents(request) {
  if (request.allowed !== false && isInsideEnclave(request.player.getLocation())) request.allowed = true;
}

module.exports = {
  name: "FeroxEnclave",
  description: "Ferox Enclave: its barriers and safe ground, the Pools of Refreshment and the Clan Wars free-for-all arena behind the white portal.",
  register(api) {
    Ferox.init(api);
    api.onCustomEvent("random-events:eligibility", allowRandomEvents);
    require("./ferox/Barriers.FeroxEnclave")(api);
    require("./ferox/Pool.FeroxEnclave")(api);
    require("./ferox/FreeForAll.FeroxEnclave")(api);
    require("./ferox/CastleWarsPortal.FeroxEnclave")(api);
  },
};
