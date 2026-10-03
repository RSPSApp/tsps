// The Inferno's 69 waves.
// Rules: https://oldschool.runescape.wiki/w/The_Inferno#Waves
//
// Every wave from 1 to 66 opens with three Jal-Nib, except the four that are six Jal-Nib and
// nothing else. The rest follows one rule per monster tier, weakest first (bat, blob, meleer,
// ranger, mager): a tier's monster first comes alone, then joins each earlier non-nibbler wave
// in turn, then comes as a pair. A nibbler-only wave closes every tier but the last.
// Wave 67 is one JalTok-Jad, 68 is three, and 69 is TzKal-Zuk.

const TIERS = ["bat", "blob", "meleer", "ranger", "mager"];
const FINAL_WAVE = 69;
const NIBBLERS_PER_WAVE = 3;
const NIBBLER_ONLY_COUNT = 6;

function buildWaves() {
  const waves = [];
  const combined = [];
  TIERS.forEach((tier, index) => {
    const tierWaves = [[tier], ...combined.map((earlier) => [...earlier, tier]), [tier, tier]];
    combined.push(...tierWaves);
    for (const monsters of tierWaves) waves.push({ nibblers: NIBBLERS_PER_WAVE, monsters });
    if (index < TIERS.length - 1) waves.push({ nibblers: NIBBLER_ONLY_COUNT, monsters: [] });
  });
  waves.push({ nibblers: 0, monsters: ["jad"] });
  waves.push({ nibblers: 0, monsters: ["jad", "jad", "jad"] });
  waves.push({ nibblers: 0, monsters: ["zuk"] });
  return waves;
}

const WAVES = buildWaves();

/** `{ nibblers, monsters }` for a wave number, monsters weakest first; null when out of range. */
function waveAt(wave) {
  return WAVES[wave - 1] ?? null;
}

module.exports = { FINAL_WAVE, JAD_WAVE: 67, TRIPLE_JAD_WAVE: 68, ZUK_WAVE: FINAL_WAVE, waveAt };
