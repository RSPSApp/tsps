/** Kourend easy diary: Xeric's talisman is twice as likely from lizardmen (OSRS Wiki). */
const LIZARDMEN = new Set(["Lizardman", "Lizardman brute", "Lizardman shaman"]);
const TALISMAN = /^Xeric's talisman \(inert\)$/i;
const FANG = /^Lizardman fang$/i;

function dropChance(api, { player, npc, source, rules }) {
  if (!npc || !LIZARDMEN.has(source)) return;
  const diary = { player, diary: "kourend", tier: "easy", complete: false };
  api.emitCustomEvent("diary:is-complete", diary);
  if (!diary.complete) return;
  rules.push({ pattern: TALISMAN, multiplier: 2 });
  // The shaman's main table replaces two of its 40 fang slots with talismans (Wiki).
  // Keeping the total at 500 preserves every other main-table probability.
  if (source === "Lizardman shaman") rules.push({ pattern: FANG, multiplier: 38 / 40 });
}

module.exports = {
  name: "KourendTalismanDrops",
  description: "Doubles Xeric's talisman drops from lizardmen after the easy Kourend diary.",
  members: true,
  register(api) {
    api.onCustomEvent("npc-drops:chance", dropChance.bind(null, api));
  },
};
