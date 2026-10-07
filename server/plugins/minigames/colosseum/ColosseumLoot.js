"use strict";

/**
 * What each wave adds to the rewards chest.
 *
 * Wiki ("Rewards Chest (Fortis Colosseum)"): the tables below, one roll per wave; wave 1 is
 * always 80 sunfire splinters. Sunfire fanatic pieces have duplicate protection: a full set
 * comes before any duplicate. Wave 12 also always gives Dizana's quiver and rolls the Smol
 * Heredit pet at 1/200. Each wave's loot is rolled before the wave and shown on the
 * intermission screen (the capture's preview of wave 1 was the 80 splinters).
 * Not included: the Varlamore token on wave 3 (its rate "varies").
 */

const FANATIC = -1;
const FANATIC_PIECES = [28933, 28936, 28939]; // helm, cuirass, chausses
const SUNFIRE_SPLINTERS = 28924;
const DIZANAS_QUIVER = 28947; // uncharged
const SMOL_HEREDIT = 28960;
const PET_CHANCE = 200;
const ATTR_FANATIC = "colosseum:fanatic-pieces";

/** By wave: [item id or FANATIC, quantity or [min, max], weight]. */
const TABLES = {
  2: [ // out of 7
    [1127, 1, 1], // Rune platebody
    [560, 150, 1], // Death rune
    [562, 150, 1], // Chaos rune
    [28924, 150, 1], // Sunfire splinters
    [2, 80, 1], // Steel cannonball
    [1201, 4, 1], // Rune kiteshield
    [1113, 1, 1], // Rune chainbody
  ],
  3: [ // out of 70
    [1127, 1, 9], // Rune platebody
    [560, 150, 9], // Death rune
    [562, 150, 9], // Chaos rune
    [28924, 150, 9], // Sunfire splinters
    [2, 80, 9], // Steel cannonball
    [1201, 4, 9], // Rune kiteshield
    [1113, 1, 9], // Rune chainbody
    [9342, 30, 1], // Onyx bolts
    [5300, 1, 1], // Snapdragon seed
    [4087, 1, 1], // Dragon platelegs
    [28924, 500, 1], // Sunfire splinters
    [575, 80, 1], // Earth orb
    [1319, 2, 1], // Rune 2h sword
    [444, 150, 1], // Gold ore
  ],
  4: [ // out of 43_400
    [1127, 1, 5535], // Rune platebody
    [560, 150, 5535], // Death rune
    [562, 150, 5535], // Chaos rune
    [28924, 150, 5535], // Sunfire splinters
    [2, 80, 5535], // Steel cannonball
    [1201, 4, 5535], // Rune kiteshield
    [1113, 1, 5535], // Rune chainbody
    [9342, 30, 615], // Onyx bolts
    [5300, 1, 615], // Snapdragon seed
    [4087, 1, 615], // Dragon platelegs
    [28924, 500, 615], // Sunfire splinters
    [575, 80, 615], // Earth orb
    [1319, 2, 615], // Rune 2h sword
    [444, 150, 615], // Gold ore
    [28942, 1, 126], // Echo crystal
    [28942, [2, 3], 14], // Echo crystal
    [FANATIC, 1, 210], // a sunfire fanatic piece
  ],
  5: [ // out of 19_250
    [9342, 30, 2725], // Onyx bolts
    [5300, 1, 2725], // Snapdragon seed
    [4087, 1, 2725], // Dragon platelegs
    [28924, 500, 2725], // Sunfire splinters
    [575, 80, 2725], // Earth orb
    [1319, 2, 2725], // Rune 2h sword
    [444, 150, 2725], // Gold ore
    [28942, 1, 63], // Echo crystal
    [28942, [2, 3], 7], // Echo crystal
    [FANATIC, 1, 105], // a sunfire fanatic piece
  ],
  6: [ // out of 16_800
    [9342, 30, 2375], // Onyx bolts
    [5300, 1, 2375], // Snapdragon seed
    [4087, 1, 2375], // Dragon platelegs
    [28924, 500, 2375], // Sunfire splinters
    [575, 80, 2375], // Earth orb
    [1319, 2, 2375], // Rune 2h sword
    [444, 150, 2375], // Gold ore
    [28942, 1, 63], // Echo crystal
    [28942, [2, 3], 7], // Echo crystal
    [FANATIC, 1, 105], // a sunfire fanatic piece
  ],
  7: [ // out of 45_920
    [9342, 30, 5832], // Onyx bolts
    [5300, 1, 5832], // Snapdragon seed
    [4087, 1, 5832], // Dragon platelegs
    [28924, 500, 5832], // Sunfire splinters
    [575, 80, 5832], // Earth orb
    [1319, 2, 5832], // Rune 2h sword
    [444, 150, 5832], // Gold ore
    [21930, 200, 756], // Dragon bolts (unf)
    [5295, 4, 756], // Ranarr seed
    [28924, 1100, 756], // Sunfire splinters
    [11237, 150, 756], // Dragon arrowtips
    [449, 100, 756], // Adamantite ore
    [560, 250, 756], // Death rune
    [28942, 1, 189], // Echo crystal
    [28942, [2, 3], 21], // Echo crystal
    [28919, 1, 35], // Tonalztics of Ralos (uncharged)
    [FANATIC, 1, 315], // a sunfire fanatic piece
  ],
  8: [ // out of 114_240
    [9342, 30, 14472], // Onyx bolts
    [5300, 1, 14472], // Snapdragon seed
    [4087, 1, 14472], // Dragon platelegs
    [28924, 500, 14472], // Sunfire splinters
    [575, 80, 14472], // Earth orb
    [1319, 2, 14472], // Rune 2h sword
    [444, 150, 14472], // Gold ore
    [9342, 50, 1876], // Onyx bolts
    [4087, 2, 1876], // Dragon platelegs
    [28924, 1750, 1876], // Sunfire splinters
    [1201, 5, 1876], // Rune kiteshield
    [451, 12, 1876], // Runite ore
    [560, 300, 1876], // Death rune
    [28942, 1, 567], // Echo crystal
    [28942, [2, 3], 63], // Echo crystal
    [28919, 1, 105], // Tonalztics of Ralos (uncharged)
    [FANATIC, 1, 945], // a sunfire fanatic piece
  ],
  9: [ // out of 21_600
    [21930, 200, 3180], // Dragon bolts (unf)
    [5295, 4, 3180], // Ranarr seed
    [28924, 1100, 3180], // Sunfire splinters
    [11237, 150, 3180], // Dragon arrowtips
    [449, 100, 3180], // Adamantite ore
    [560, 250, 3180], // Death rune
    [9342, 75, 424], // Onyx bolts
    [28924, 2500, 424], // Sunfire splinters
    [4087, 3, 424], // Dragon platelegs
    [560, 300, 424], // Death rune
    [1347, 5, 424], // Rune warhammer
    [28942, 1, 135], // Echo crystal
    [28942, [2, 3], 15], // Echo crystal
    [28919, 1, 25], // Tonalztics of Ralos (uncharged)
    [FANATIC, 1, 225], // a sunfire fanatic piece
  ],
  10: [ // out of 16_000
    [9342, 50, 2340], // Onyx bolts
    [4087, 2, 2340], // Dragon platelegs
    [28924, 1750, 2340], // Sunfire splinters
    [1201, 5, 2340], // Rune kiteshield
    [451, 12, 2340], // Runite ore
    [560, 300, 2340], // Death rune
    [9342, 100, 312], // Onyx bolts
    [1347, 8, 312], // Rune warhammer
    [4087, 3, 312], // Dragon platelegs
    [28924, 3500, 312], // Sunfire splinters
    [11237, 250, 312], // Dragon arrowtips
    [28942, 1, 135], // Echo crystal
    [28942, [2, 3], 15], // Echo crystal
    [28919, 1, 25], // Tonalztics of Ralos (uncharged)
    [FANATIC, 1, 225], // a sunfire fanatic piece
  ],
  11: [ // out of 2_080
    [9342, 75, 360], // Onyx bolts
    [28924, 2500, 360], // Sunfire splinters
    [4087, 3, 360], // Dragon platelegs
    [560, 300, 360], // Death rune
    [1347, 5, 360], // Rune warhammer
    [2, 2000, 50], // Steel cannonball
    [4585, 5, 50], // Dragon plateskirt
    [11237, 350, 50], // Dragon arrowtips
    [9342, 150, 50], // Onyx bolts
    [28942, 1, 27], // Echo crystal
    [28942, [2, 3], 3], // Echo crystal
    [28919, 1, 5], // Tonalztics of Ralos (uncharged)
    [FANATIC, 1, 45], // a sunfire fanatic piece
  ],
  12: [ // out of 4_800
    [9342, 100, 792], // Onyx bolts
    [1347, 8, 792], // Rune warhammer
    [4087, 3, 792], // Dragon platelegs
    [28924, 3500, 792], // Sunfire splinters
    [11237, 250, 792], // Dragon arrowtips
    [6571, 1, 110], // Uncut onyx
    [4585, 5, 110], // Dragon plateskirt
    [1319, 9, 110], // Rune 2h sword
    [451, 35, 110], // Runite ore
    [28942, 1, 135], // Echo crystal
    [28942, [2, 3], 15], // Echo crystal
    [28919, 1, 25], // Tonalztics of Ralos (uncharged)
    [FANATIC, 1, 225], // a sunfire fanatic piece
  ],};

/** The fanatic piece the player has had fewest of, so a set completes before duplicates. */
function fanaticPiece(player, random) {
  const had = player.getAttribute(ATTR_FANATIC) ?? {};
  const fewest = Math.min(...FANATIC_PIECES.map((id) => had[id] ?? 0));
  const options = FANATIC_PIECES.filter((id) => (had[id] ?? 0) === fewest);
  return options[Math.floor(random() * options.length)];
}

/** A wave's loot is the player's: fanatic pieces count towards the set from here. */
function received(player, items) {
  const had = { ...(player.getAttribute(ATTR_FANATIC) ?? {}) };
  for (const { id } of items) if (FANATIC_PIECES.includes(id)) had[id] = (had[id] ?? 0) + 1;
  player.setAttribute(ATTR_FANATIC, had);
}

function pickWeighted(table, random) {
  const total = table.reduce((sum, [, , weight]) => sum + weight, 0);
  let roll = random() * total;
  return table.find(([, , weight]) => (roll -= weight) < 0) ?? table[table.length - 1];
}

/** The items a wave adds, as [{ id, amount }]. */
function roll(wave, player, random = Math.random) {
  if (wave <= 1) return [{ id: SUNFIRE_SPLINTERS, amount: 80 }];
  const [id, quantity] = pickWeighted(TABLES[Math.min(wave, 12)], random);
  const [min, max] = Array.isArray(quantity) ? quantity : [quantity, quantity];
  const amount = min + Math.floor(random() * (max - min + 1));
  const items = [{ id: id === FANATIC ? fanaticPiece(player, random) : id, amount }];
  if (wave >= 12) items.push({ id: DIZANAS_QUIVER, amount: 1 });
  return items;
}

/** Wave 12's flat pet roll. */
function rollsPet(random = Math.random) {
  return Math.floor(random() * PET_CHANCE) === 0;
}

module.exports = { TABLES, FANATIC, FANATIC_PIECES, SUNFIRE_SPLINTERS, DIZANAS_QUIVER, SMOL_HEREDIT, ATTR_FANATIC, roll, received, rollsPet };
