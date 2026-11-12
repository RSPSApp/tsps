const Pickpocket = require("./thieving/Pickpocket.Thieving");
const CoinPouch = require("./thieving/CoinPouch.Thieving");
const Stalls = require("./thieving/Stalls.Thieving");
const ArdougneCastleDoors = require("./thieving/ArdougneCastleDoors.Thieving");

module.exports = {
  name: "Thieving",
  description: "Thieving: pickpocketing NPCs, opening coin pouches, stealing from stalls, blackjacking, the ham trapdoor, the Ardougne castle doors and Dorgesh-Kaan's rich chests.",
  members: true,
  register(api) {
    Pickpocket.register(api);
    CoinPouch.register(api);
    require("./thieving/Blackjacking.Thieving")(api);
    Stalls(api);
    require("./thieving/HamTrapdoor.Thieving")(api);
    ArdougneCastleDoors.register(api);
    require("./thieving/DorgeshKaanRichChest.Thieving")(api);
  },
};

module.exports._test = { ...Pickpocket._test, ...Stalls._test, ...ArdougneCastleDoors._test };
