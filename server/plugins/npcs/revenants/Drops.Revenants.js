/**
 * The revenants' shared drop table, from the OSRS Wiki's revenant drops template (rates
 * "provided by Jagex"): https://oldschool.runescape.wiki/w/Template:Revenants/Drops
 *
 * With A = floor(2200 / floor(sqrt(combat))) and B = 15 + floor((combat + 60)^2 / 200), a roll
 * of 0..A-1 gives the ancient artefact table on 0, the main table below min(A, B), and coins
 * otherwise. The unique table (1/(A x 26.667), skulled x1/0.55, on task x5), the blighted
 * secondary (100/(250 - combat)), the tertiaries and the ether roll on their own.
 */
const { REVENANTS, ITEMS } = require("./Data.Revenants");

/** Unique table: avarice 2/5, each weapon 1/5. */
const UNIQUES = [
  [22557, 2], // Amulet of avarice
  [22547, 1], // Craw's bow (u)
  [22552, 1], // Thammaron's sceptre (u)
  [22542, 1], // Viggora's chainmace (u)
];
const UNIQUE_RATE = 26.667;
const UNIQUE_SKULLED = 0.55;
const UNIQUE_ON_TASK = 0.2;

/** Ancient artefact table: [item, unskulled weight (of 40), skulled weight (of 22), min, max]. */
const ARTEFACTS = [
  [22305, 1, 1, 1, 1], // Ancient relic
  [22302, 1, 1, 1, 1], // Ancient effigy
  [22299, 1, 1, 1, 1], // Ancient medallion
  [21813, 2, 2, 1, 1], // Ancient statuette
  [5316, 4, 4, 2, 6], // Magic seed
  [5315, 4, 4, 2, 6], // Yew seed
  [21804, 3, 3, 1, 1], // Ancient crystal
  [21810, 4, 4, 1, 1], // Ancient totem
  [21807, 6, 1, 1, 1], // Ancient emblem
  [1149, 13, 0, 1, 1], // Dragon med helm (never when skulled)
];
const ARTEFACT_TOTAL = { unskulled: 40, skulled: 22 };

/** Main table, weights out of 198: [item, weight, min, max, noted]. */
const MAIN = [
  [ITEMS.BRACELET_UNCHARGED, 30, 1, 1],
  [1391, 10, 4, 4], // Battlestaff
  [1163, 4, 2, 2], // Rune full helm
  [1127, 4, 2, 2], // Rune platebody
  [1079, 4, 2, 2], // Rune platelegs
  [1201, 4, 2, 2], // Rune kiteshield
  [1347, 4, 2, 2], // Rune warhammer
  [4087, 1, 1, 2], // Dragon platelegs
  [4585, 1, 1, 2], // Dragon plateskirt
  [1215, 2, 2, 2], // Dragon dagger
  [1305, 2, 2, 2], // Dragon longsword
  [9193, 6, 20, 40], // Dragonstone bolt tips
  [9194, 6, 3, 6], // Onyx bolt tips
  [560, 10, 30, 60], // Death rune
  [565, 10, 50, 100], // Blood rune
  [563, 10, 20, 45], // Law rune
  [453, 12, 30, 60, true], // Coal
  [2361, 12, 4, 6], // Adamantite bar
  [451, 8, 2, 4], // Runite ore
  [2363, 6, 2, 3], // Runite bar
  [1747, 8, 4, 4], // Black dragonhide
  [8782, 6, 8, 16, true], // Mahogany plank
  [24589, 8, 10, 15], // Blighted manta ray
  [1515, 8, 20, 40, true], // Yew logs
  [1513, 4, 8, 16, true], // Magic logs
  [1631, 2, 2, 5], // Uncut dragonstone
  [21802, 10, 1, 5], // Revenant cave teleport
  [24598, 6, 1, 3], // Blighted super restore(4)
];
const MAIN_TOTAL = 198;

/** Blighted secondary, weights out of 100, rolled at 100 / (250 - combat). */
const BLIGHTED = [
  [24607, 10, 1, 10], // Blighted ancient ice sack
  [24613, 20, 1, 10], // Blighted entangle sack
  [24615, 10, 1, 10], // Blighted teleport spell sack
  [24621, 10, 1, 10], // Blighted vengeance sack
  [24589, 15, 1, 2], // Blighted manta ray
  [24592, 15, 1, 2], // Blighted anglerfish
  [24595, 10, 1, 2], // Blighted karambwan
  [24598, 5, 1, 1], // Blighted super restore(4)
  [21802, 5, 1, 1], // Revenant cave teleport
];

const LOOTING_BAG = 11941;
const CHAMPION_SCROLLS = {
  [REVENANTS.IMP]: 6803,
  [REVENANTS.GOBLIN]: 6801,
  [REVENANTS.HOBGOBLIN]: 6802,
};

function thresholds(combat) {
  const A = Math.floor(2200 / Math.floor(Math.sqrt(combat)));
  const B = 15 + Math.floor(((combat + 60) ** 2) / 200);
  return { A, B };
}

const between = (random, min, max) => min + Math.floor(random() * (max - min + 1));

function pick(random, rows, total, weightOf) {
  let roll = Math.floor(random() * total);
  for (const row of rows) {
    roll -= weightOf(row);
    if (roll < 0) return row;
  }
  return null;
}

/**
 * Rolls one kill. `combat` is the revenant's combat level. Returns [{ itemId, amount, noted }]
 * with the ether first.
 */
function rollDrops({ npcId, combat, skulled = false, onTask = false, random = Math.random }) {
  const drops = [];
  const sqrt = Math.floor(Math.sqrt(combat));
  // Always: 2 to (floor(sqrt(combat)) + 1) x 2 ether, in even amounts.
  drops.push({ itemId: ITEMS.ETHER, amount: 2 * between(random, 1, sqrt + 1) });

  const { A, B } = thresholds(combat);
  const uniqueOdds = A * UNIQUE_RATE * (skulled ? UNIQUE_SKULLED : 1) * (onTask ? UNIQUE_ON_TASK : 1);
  if (random() * uniqueOdds < 1) {
    const [itemId] = pick(random, UNIQUES, 5, (row) => row[1]);
    drops.push({ itemId, amount: 1 });
  }

  const roll = Math.floor(random() * A);
  if (roll === 0) {
    const total = skulled ? ARTEFACT_TOTAL.skulled : ARTEFACT_TOTAL.unskulled;
    const row = pick(random, ARTEFACTS, total, (r) => (skulled ? r[2] : r[1]));
    if (row) drops.push({ itemId: row[0], amount: between(random, row[3], row[4]) });
  } else if (roll < Math.min(A, B)) {
    const [itemId, , min, max, noted] = pick(random, MAIN, MAIN_TOTAL, (row) => row[1]);
    drops.push({ itemId, amount: between(random, min, max), noted: noted === true });
  } else {
    drops.push({ itemId: ITEMS.COINS, amount: between(random, 1, 1 + 25 * sqrt) });
  }

  if (random() * (250 - combat) < 100) {
    const [itemId, , min, max] = pick(random, BLIGHTED, 100, (row) => row[1]);
    drops.push({ itemId, amount: between(random, min, max) });
  }

  const bagOdds = combat < 10 ? 15 : combat > 50 ? 3 : Math.floor(150 / combat);
  if (random() * bagOdds < 1) drops.push({ itemId: LOOTING_BAG, amount: 1 });
  const scroll = CHAMPION_SCROLLS[npcId];
  if (scroll && random() * 5000 < 1) drops.push({ itemId: scroll, amount: 1 });
  return drops;
}

module.exports = { rollDrops, thresholds, UNIQUES, ARTEFACTS, MAIN, BLIGHTED, MAIN_TOTAL };
