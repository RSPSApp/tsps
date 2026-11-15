const Pickpocket = require("./thieving/Pickpocket.Thieving");
const CoinPouch = require("./thieving/CoinPouch.Thieving");
const Stalls = require("./thieving/Stalls.Thieving");
const ArdougneCastleDoors = require("./thieving/ArdougneCastleDoors.Thieving");

module.exports = {
  name: "Thieving",
  description: "Thieving: pickpocketing NPCs (with the Civitas urchins' distractions of the Wealthy citizens), opening coin pouches, stealing from stalls, blackjacking, the ham trapdoor, the Ardougne castle doors, Dorgesh-Kaan's rich and average chests, the Isle of Souls Dungeon chest, the Aldarin villa chests, the magic axe hut and Pirates' Hideout lock-pick doors, the Crumbling Tower's Dark Chest and Civitas illa Fortis's house robbery (stealing valuables).",
  members: true,
  register(api) {
    Pickpocket.register(api);
    require("./thieving/WealthyCitizens.Thieving")(api);
    CoinPouch.register(api);
    require("./thieving/Blackjacking.Thieving")(api);
    Stalls(api);
    require("./thieving/HamTrapdoor.Thieving")(api);
    ArdougneCastleDoors.register(api);
    require("./thieving/DorgeshKaanChests.Thieving")(api);
    require("./thieving/SoulChest.Thieving")(api);
    require("./thieving/PicklockChests.Thieving")(api);
    require("./thieving/LockedDoors.Thieving")(api);
    require("./thieving/DarkChest.Thieving")(api);
    require("./thieving/HouseRobbery.Thieving")(api);
    require("./thieving/HouseRobberyCrew.Thieving")(api);
  },
};

module.exports._test = { ...Pickpocket._test, ...Stalls._test, ...ArdougneCastleDoors._test };
