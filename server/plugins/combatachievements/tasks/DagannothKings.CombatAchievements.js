/**
 * The Dagannoth Kings: all three dead within 9 seconds of the first (Rapid Succession), and Rex
 * dying on the same tick as another king (Toppling the Diarchy). The kills a player took part
 * in are kept for the 9 seconds.
 */
const KINGS = ["Dagannoth Rex", "Dagannoth Prime", "Dagannoth Supreme"];
const RAPID_SUCCESSION_TICKS = 15; // 9 seconds

/** player -> Map(king name -> tick it died). */
const deaths = new WeakMap();

function attachDagannothKingsTasks(api, Fights) {
  const tick = () => api.core.World.getProcessCycle();
  const record = (fight) => {
    const now = tick();
    const mine = deaths.get(fight.player) ?? new Map();
    for (const [name, at] of mine) if (now - at > RAPID_SUCCESSION_TICKS) mine.delete(name);
    mine.set(fight.npcName, now);
    deaths.set(fight.player, mine);
    return mine;
  };
  for (const king of KINGS) {
    Fights.onKill(king, {
      "Rapid Succession": (fight) => KINGS.every((name) => record(fight).has(name)),
      "Toppling the Diarchy": (fight) => {
        // Recorded by either rule: the other may be done already and not asked.
        const mine = record(fight);
        const now = tick();
        const sameTick = KINGS.filter((name) => mine.get(name) === now);
        return sameTick.includes("Dagannoth Rex") && sameTick.length >= 2;
      },
    });
  }
}

module.exports = attachDagannothKingsTasks;
