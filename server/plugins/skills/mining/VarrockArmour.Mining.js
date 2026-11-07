/** Ordinary metal rocks: https://oldschool.runescape.wiki/w/Mining_enhancers */
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
  tierByOre = new Map([
    [I.COPPER_ORE, 1], [I.TIN_ORE, 1], [I.IRON_ORE, 1], [I.SILVER_ORE, 1],
    [I.COAL, 1], [I.GOLD_ORE, 1], [I.LEAD_ORE, 1], [I.MITHRIL_ORE, 2], [I.ADAMANTITE_ORE, 3],
    [I.RUNITE_ORE, 4],
  ]);
  api.onCustomEvent("mining:extra-ore", extraOre);
}

module.exports = { attach };
