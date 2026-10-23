const registerDharoksArmourEffects = require("./effects/DharoksArmour.EquipmentEffects");
const registerObsidianEffects = require("./effects/ObsidianArmour.EquipmentEffects");
const registerInquisitorsArmourEffects = require("./effects/InquisitorsArmour.EquipmentEffects");
const registerChaosGauntletsEffects = require("./effects/ChaosGauntlets.EquipmentEffects");
const registerLeafBladedBattleaxeEffects = require("./effects/LeafBladedBattleaxe.EquipmentEffects");
const registerJusticiarEffects = require("./effects/JusticiarArmour.EquipmentEffects");
const registerSalveAmuletEffects = require("./effects/SalveAmulet.EquipmentEffects");
const registerDragonHunterEffects = require("./effects/DragonHunter.EquipmentEffects");
const registerDemonbaneEffects = require("./effects/Demonbane.EquipmentEffects");
const registerVampyrebaneEffects = require("./effects/Vampyrebane.EquipmentEffects");
const registerSpiritShieldEffects = require("./effects/SpiritShields.EquipmentEffects");
const registerBlackjackEffects = require("./effects/Blackjack.EquipmentEffects");

module.exports = {
  name: "EquipmentEffects",
  register(api) {
    registerDharoksArmourEffects(api);
    registerObsidianEffects(api);
    registerInquisitorsArmourEffects(api);
    registerChaosGauntletsEffects(api);
    registerLeafBladedBattleaxeEffects(api);
    registerJusticiarEffects(api);
    registerSalveAmuletEffects(api);
    registerDragonHunterEffects(api);
    registerDemonbaneEffects(api);
    registerVampyrebaneEffects(api);
    registerSpiritShieldEffects(api);
    registerBlackjackEffects(api);
  },
};
