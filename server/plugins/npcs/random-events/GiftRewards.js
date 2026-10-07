"use strict";

// Current OSRS Rick/Certer table (150 weighted entries); see SOURCES.md.
function roll(api) {
  const I = api.core.ItemIdentifiers;
  const table = [
    [I.COINS, 80, 10], [I.COINS, 160, 10], [I.COINS, 240, 6],
    [I.COINS, 320, 10], [I.COINS, 480, 10], [I.COINS, 640, 10],
    [I.KEBAB, 1, 16], [I.SPINACH_ROLL, 1, 14],
    [I.UNCUT_SAPPHIRE, 1, 32], [I.UNCUT_EMERALD, 1, 16],
    [I.UNCUT_RUBY, 1, 8], [I.UNCUT_DIAMOND, 1, 2],
    [I.COSMIC_TALISMAN, 1, 4], [I.TOOTH_HALF_OF_KEY, 1, 1], [I.LOOP_HALF_OF_KEY, 1, 1],
  ];
  let choice = Math.floor(Math.random() * 150);
  for (const [id, amount, weight] of table) {
    if (choice < weight) {
      if (!api.core.WorldDefinition.isMembersWorld() &&
          (id === I.TOOTH_HALF_OF_KEY || id === I.LOOP_HALF_OF_KEY)) return { id: I.COINS, amount: 640 };
      return { id, amount };
    }
    choice -= weight;
  }
}

module.exports = { roll };
