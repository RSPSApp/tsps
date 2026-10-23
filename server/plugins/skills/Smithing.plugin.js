/**
 * Smithing: smelting at furnaces and smithing at anvils. The units live in smithing/:
 * Data (cache products + data/smithing.json), Sessions (the make-X loops), Smelting, Anvil,
 * Cannonballs, Gear (ring of forging, Varrock armour), Godswords, DragonShields (dragon and
 * visage shields, the dragon forge), Spears (the barbarian anvil) and Superheat.
 * docs/smithing.md has the sources.
 */
const Core = require("./smithing/Core.Smithing");
const Data = require("./smithing/Data.Smithing");
const Sessions = require("./smithing/Sessions.Smithing");
const Smelting = require("./smithing/Smelting.Smithing");
const Anvil = require("./smithing/Anvil.Smithing");
const Cannonballs = require("./smithing/Cannonballs.Smithing");
const Gear = require("./smithing/Gear.Smithing");
const Godswords = require("./smithing/Godswords.Smithing");
const DragonShields = require("./smithing/DragonShields.Smithing");
const Spears = require("./smithing/Spears.Smithing");
const Superheat = require("./smithing/Superheat.Smithing");

const FURNACE_NAMES = new Set(["Furnace", "Small furnace", "Lovakite furnace"]);

function useItemOnObject(event) {
  const name = event.object.getDefinition().getName();
  if (FURNACE_NAMES.has(name)) Cannonballs.useOnFurnace(event) || Smelting.useOnFurnace(event);
  else if (name === "Rusted anvil") Anvil.useOnAnvil(event);
  else if (Anvil.ANVIL_NAMES.includes(name)) Godswords.useOnAnvil(event) || DragonShields.useOnAnvil(event) || Anvil.useOnAnvil(event);
  else if (event.objectId === Core.CacheDefinitions.getLocId(DragonShields.SHIELD_MACHINE)) DragonShields.useOnShieldMachine(event);
}

function disconnect({ player }) {
  Sessions.stop(player, false);
  Anvil.forget(player);
}

function levelUpPopup({ player }) {
  Sessions.stop(player, false);
}

function startBotSmelting(player, recipe, amount) {
  return Smelting.startSmelting(player, recipe, amount);
}

module.exports = {
  name: "Smithing",
  SMELTING_RECIPES: Data.SMELTING_RECIPES,
  FURNACE_OBJECT_IDS: Smelting.FURNACE_OBJECT_IDS,
  SMITHING_BAR_TYPE_BY_ITEM_ID: Data.BAR_TYPE_BY_BAR,
  SMELTING_SKILLMULTI_OP_FLAGS: Smelting.SMELTING_SKILLMULTI_OP_FLAGS,
  quantityForSmeltAction: Smelting.quantityForSmeltAction,
  hasIngredients: Smelting.hasIngredients,
  consumeIngredients: Smelting.consumeIngredients,
  smeltingXp: Smelting.smeltingXp,
  /** Fills SMELTING_RECIPES for a plugin that needs them before Smithing registers. */
  loadData: Data.load,
  startBotSmelting,
  isSmeltingActive: Smelting.isSmeltingActive,
  register(api) {
    Core.init(api);
    api.onPlayerDisconnect(disconnect);
    api.onCustomEvent("level-up:popup-opened", levelUpPopup);
    api.onItemOnObject(useItemOnObject, { noted: false });
    Sessions(api);
    Smelting(api);
    Anvil(api);
    Cannonballs(api);
    Gear(api);
    Godswords(api);
    DragonShields(api);
    Spears(api);
    Superheat(api);
  },
};
