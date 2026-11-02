const Pickpocket = require("./thieving/Pickpocket.Thieving");
const CoinPouch = require("./thieving/CoinPouch.Thieving");
const Stalls = require("./thieving/Stalls.Thieving");

module.exports = {
  name: "Thieving",
  members: true,
  register(api) {
    Pickpocket.register(api);
    CoinPouch.register(api);
    require("./thieving/Blackjacking.Thieving")(api);
    Stalls(api);
    require("./thieving/HamTrapdoor.Thieving")(api);
  },
};

module.exports._test = { ...Pickpocket._test, ...Stalls._test };
