/**
 * Fairytale II's quest journal, as live writes it (rsprox capture FairyTale2, rev 242.1, questjournal
 * 119 at ticks 215 (stage 20), 313 (30), 531 (40), 1236 (50), 1654 (60), 1921, 2105 and 2374 (70)).
 *
 * Jagex breaks these lines by hand, so they are kept as captured. Stages the capture never opened the
 * journal at (0-10, 45, 65, 72-80 and the completed quest) are Ours: they reuse the nearest captured
 * page, as noted at each.
 */
const BLUE = "<col=000080>";
const RED = "<col=800000>";
const struck = (lines) => lines.map((line) => `<str>${line}`);
const blue = (lines) => lines.map((line) => `${BLUE}${line}`);

const MARTIN = [
  "I have spoken to Martin. He told me that his crops are still not",
  "growing.",
];
const GROTTO = [
  "I returned to Zanaris and found Fairy Nuff's grotto",
  "ransacked and Fairy Nuff and the Fairy Queen missing!",
];
/** Stage 40 (tick 531); from stage 50 the second line goes on "to look for the Fairy Queen." (1236). */
const PERMISSION = [
  "I spoke to the Fairy Godfather, he has told me I can use the",
  "fairy rings.",
];
const PERMISSION_LATER = [
  "I spoke to the Fairy Godfather, he has told me I can use the",
  "fairy rings to look for the Fairy Queen.",
];
/** Stage 40 with the Rune temple sign read (tick 531, varbit 2338 = 4). */
const PLAQUE = [
  `${BLUE}I found a plaque with some strange inscriptions on, near the`,
  `${BLUE}mysterious ruin in Zanaris. Maybe I can use this to decode the`,
  `${BLUE}message I found on the ${RED}certificate${BLUE}, which seems quite`,
  `${BLUE}important - ${RED}I should keep it with me${BLUE}.`,
];
const HIDEOUT = [
  "I found a secret message on the back of Fairy Nuff's",
  "certificate and used it to get to the fairies' hideout, where I",
  "found Fairy Nuff and the Fairy Queen.",
];
const GET_SECATEURS = [
  "The Godfather still has the Fairy Queen's enchanted",
  "secateurs, I need to find a way to get them back from him and",
  "then take them to Fairy Nuff.",
  "Fairy Very Wise told me that the Godfather's henchmen have",
  "keen eyes and will be watching out for him.",
];
const STOLE = [
  "Fairy Nuff sent me back to Zanaris where I stole the Fairy",
  "Queen's enchanted secateurs back from the Godfather.",
];
const AWAKENING = [
  "I took the enchanted secateurs back to Fairy Nuff and she",
  "cast a spell of awakening on the Fairy Queen, however too",
  "much time had lapsed and so it didn't work.",
];
const POTION = [
  "I need to mix up a potion of Magic Essence and give it to Fairy",
  "Nuff.",
  "The ingredients are:",
];
/** Each ingredient: its red name, then its blue hint; once it is held only the struck name stays (2105, 2374). */
const STAR_FLOWER = [
  "A Star Flower",
  "Star Flowers only grow on the higher planes, I might be able to",
  "find one by using the fairy rings.",
];
const GORAK_CLAW = [
  "A ground Gorak's claw",
  "Goraks live on a different plane. The only way to get there is",
  "through the fairy rings.",
];

function ingredient([name, ...hint], have) {
  return have ? [`<str>${name}`] : [`${RED}${name}`, ...blue(hint)];
}

/**
 * The journal for a stage. `signRead`: varbit 2338 set; `flower`/`claw`: the player holds that
 * ingredient (or what it went into), which strikes it through.
 */
function buildLines({ stage, signRead = false, flower = false, claw = false }) {
  if (stage <= 0) {
    // Ours.
    return [
      "I can start this quest by speaking to",
      "<col=800000>Martin the Master Gardener</col> in Draynor Village.",
      "",
      "I must have completed <col=800000>Fairytale I - Growing Pains</col>.",
    ];
  }
  if (stage < 20) {
    // Ours.
    return [
      "Martin the Master Gardener has planted new seeds and wants me to",
      "come back once his crops have had time to grow.",
    ];
  }
  if (stage < 30) return [...struck(MARTIN), `${BLUE}I should go to Zanaris and try to find out what the problem is.`];
  const grotto = [...struck(MARTIN), ...struck(GROTTO)];
  // Ours: before the sign is read at stage 30, the stage-30 page (313).
  if (stage < 40) return [...grotto, ...(signRead ? PLAQUE : [`${BLUE}I should try to find out what happened.`])];
  if (stage < 45) return [...grotto, ...struck(PERMISSION), ...(signRead ? PLAQUE : [])];
  const found = [...grotto, ...struck(PERMISSION_LATER), ...struck(HIDEOUT)];
  // Ours: 45 (Fairy Very Wise's news, before her pickpocket advice) reuses the stage-50 page.
  if (stage < 60) return [...found, ...blue(GET_SECATEURS)];
  if (stage < 65) return [...found, ...struck(STOLE), `${BLUE}I need to take them back to Fairy Nuff.`];
  const recipe = [...found, ...struck(STOLE), ...struck(AWAKENING)];
  const ingredients = [...blue(POTION), ...ingredient(STAR_FLOWER, flower), ...ingredient(GORAK_CLAW, claw)];
  // Ours: 65 (the recipe still being told) and 72-80 reuse the stage-70 page.
  if (stage < 90) return [...recipe, ...ingredients];
  // Ours: the completed journal strikes the last page through.
  return [...struck(recipe), ...struck([...POTION, STAR_FLOWER[0], GORAK_CLAW[0]]), "", "<col=ff0000>QUEST COMPLETE!"];
}

module.exports = { buildLines };
