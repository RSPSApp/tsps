"use strict";

/**
 * The name TzHaar call the player by (Wiki: TzHaar): race, caste, honorific, then the player's
 * own name, as "JalYt-Mej-Xo-Name". Shared by the city's NPCs and TzHaar-Ket-Rak.
 */
const RACE = "JalYt";

const CASTE_PAIRS = [
  ["Mej", "MAGIC", "PRAYER"],
  ["Ket", "STRENGTH", "DEFENCE"],
  ["Xil", "ATTACK", "AGILITY"],
  ["Hur", "CRAFTING", "SMITHING"],
];

/** The skill pair with the highest total (base levels), ties going Mej, Ket, Xil, Hur. */
function caste(player, Skill) {
  const skills = player.getSkillManager();
  let best = null;
  for (const [name, a, b] of CASTE_PAIRS) {
    const total = skills.getMaxLevel(Skill[a]) + skills.getMaxLevel(Skill[b]);
    if (!best || total > best.total) best = { name, total };
  }
  return best.name;
}

/**
 * "JalYt-Mej", with "-Kal" once TzKal-Zuk is beaten or "-Xo" once into the inner core of
 * Mor Ul Rek (Wiki: TzHaar, honorifics).
 */
function title(player, Skill, { innerCore, beatenZuk }) {
  const honorific = beatenZuk ? "-Kal" : innerCore ? "-Xo" : "";
  return `${RACE}-${caste(player, Skill)}${honorific}`;
}

module.exports = { CASTE_PAIRS, caste, title };
