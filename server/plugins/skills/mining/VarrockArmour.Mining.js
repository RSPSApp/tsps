/** Eligible rocks (including tephra): https://oldschool.runescape.wiki/w/Mining_enhancers */
let core;
let tierByArmour;
let tierByOre;

function extraOre(request) {
  if (!core.WorldDefinition.isMembersWorld()) return;
  const body = request.player.getEquipment().getItems()[core.Equipment.BODY_SLOT];
  const tier = tierByArmour.get(body?.getId());
  const required = tierByOre.get(request.oreId);
  if (!tier || !required || tier < required || Math.random() >= 0.1) return;
  request.bonuses.push({});
}

function attach(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  tierByArmour = new Map([
    [I.VARROCK_ARMOUR_1, 1], [I.VARROCK_ARMOUR_2, 2],
    [I.VARROCK_ARMOUR_3, 3], [I.VARROCK_ARMOUR_4, 4],
  ]);
  // The Mining enhancers table's Varrock armour column (the lowest tier that adds an ore from the rock).
  // Sandstone and granite pieces are keyed by each size the rock yields.
  tierByOre = new Map([
    [I.TEPHRA, 1], [I.CLAY, 1], [I.COPPER_ORE, 1], [I.TIN_ORE, 1], [I.BLURITE_ORE, 1], [I.LIMESTONE, 1],
    [I.IRON_ORE, 1], [I.SILVER_ORE, 1], [I.COAL, 1], [I.GOLD_ORE, 1], [I.LEAD_ORE, 1],
    [I.MITHRIL_ORE, 2], [I.LOVAKITE_ORE, 2], [I.SOFT_CLAY, 2], [I.RUBIUM_SPLINTERS, 2],
    [6971, 2], [6973, 2], [6975, 2], [6977, 2], // sandstone 1/2/5/10kg
    [6979, 2], [6981, 2], [6983, 2], // granite 500g/2kg/5kg
    [I.ADAMANTITE_ORE, 3], [I.SUNSTONE, 3],
    [I.RUNITE_ORE, 4], [I.NICKEL_ORE, 4], [I.AMETHYST, 4],
  ]);
  api.onCustomEvent("mining:extra-ore", extraOre);
}

module.exports = { attach };
