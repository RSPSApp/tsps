/**
 * Fairytale I's quest journal, as live writes it (rsprox captures: FairyTale1, rev 242.1, questjournal
 * 119 at ticks 811, 1167, 1398, 1630, 1829, 2480, 3314 and 4001; the user's rev 241 run 1001455 at
 * ticks 637, 819, 876, 977, 1117, 1178, 1213, 1943 and 3249).
 *
 * Jagex breaks these lines by hand (several stop well short of the width), so they are kept as
 * captured. The recipe is the exception: its item names vary, and live wraps that sentence
 * itself (it breaks inside an item name in both captures).
 */
const BLUE = "<col=000080>";
const RED = "<col=800000>";
const red = (text) => `${RED}${text}${BLUE}`;
const struck = (lines) => lines.map((line) => `<str>${line}`);

const MARTIN = [
  "I spoke to Martin the Master Gardner who told me the",
  "gardeners are suffering unseasonal bad harvests.",
];
/** Stage 10, by how many of the five gardeners have answered (1001455 ticks 637-1117; 811). */
const GARDENER_PROGRESS = [
  ["I will need to speak to other gardeners to get details."],
  [
    "I've spoken to one gardener who told me the problem is the",
    "lack of rain. I'd better speak to some other gardeners to get",
    "more details.",
  ],
  [
    "I've spoken to a couple of gardeners who gave me different",
    "stories. I should speak to some other gardeners to get more",
    "details.",
  ],
  [
    "I've spoken to three gardeners who gave me conflicting",
    "stories. I should speak to some other gardeners to get more",
    "details.",
  ],
  [
    "I've spoken to four gardeners who all have different ideas",
    "about what the problem actually is. I should speak to some",
    "other gardeners to get more details.",
  ],
  [
    "I've spoken to several gardeners who all have different ideas",
    "about what the problem actually is. I'd better go back and talk",
    `to ${red("Martin")} again.`,
  ],
];
const FAIRIES = [
  "The gardeners seem to think that the fairies are responsible.",
  `I should talk to the ${red("Fairy Queen")}.`,
];
const GODFATHER = [
  "I have spoken to the gardeners who are members of the",
  "Group of Advanced Gardeners. They sent me to Zanaris to",
  "talk to the Fairy Queen.",
  "I discovered that the Fairy Queen was missing. The Fairy",
  "Godfather told me that she was extremely sick.",
];
const SEE_NUFF = [
  `I need to speak to a ${red("fairy called Nuff")}, to get more details`,
  "about her condition.",
];
const SEE_ZANDAR = [
  `I spoke to ${red("Fairy Nuff")} who sent me, with a list of the Fairy`,
  `Queens' symptoms, to find a mage called ${red("Zandar Horfyre")} at`,
  `the ${red("Dark Wizards' Tower")}.`,
];
const SAW_ZANDAR = [
  "I spoke to fairy Nuff who sent me, with a list of the Fairy",
  "Queens' symptoms, to find a mage called Zandar Horfyre.",
];
/** The completed journal rewords these two (1001455 tick 3249). */
const SAW_ZANDAR_DONE = [
  "I spoke to Fairy Nuff who sent me, with a list of the Fairy",
  "Queen's symptoms, to find a mage called Zandar Horfyre.",
];
const SEE_MALIGNIUS = [
  `He told me that the ${red("Fairy Queen")} had lost her magical essence`,
  `and that I would have to kill the ${red("Tanglefoot")} to get it back. I`,
  `should speak to a necromancer named ${red("Malignus Mortifer")} to`,
  `find out how to kill it. He is rumoured to be near ${red("Port Sarim")}.`,
];
const SAW_MALIGNIUS = [
  "He told me that the Fairy Queen had lost her magical essence",
  "and that I would have to kill the Tanglefoot to get it back.",
];
const ENCHANTED = [
  `The ${red("Nature Spirit")} has enchanted a pair of secateurs for me to`,
  `use in my battle with the ${red("Tanglefoot")}.`,
];
const USED_SECATEURS = [
  "The Nature Spirit enchanted a pair of secateurs for me, which",
  "I used to kill the Tanglefoot.",
];
const RETURN_SECATEURS = [
  `I got back the ${red("Fairy Queens' Enchanted Secateurs")} and now`,
  `need to take them back to the ${red("Fairy Godfather")}.`,
];
const RETURNED_SECATEURS = [
  "I got back the Fairy Queen's Enchanted Secateurs and",
  "returned them to the Fairy Godfather.",
];

/**
 * Ours: the width the recipe sentence wraps at. Measured in the cache's chat font (497), the two
 * captured recipes break after 405-406 pixels and before 465-473, so any width in [406, 465)
 * reproduces both (FairyTale1 tick 2480, 1001455 tick 1943).
 */
const RECIPE_WRAP_WIDTH = 435;

/** Words of `text` (which may carry colour tags) wrapped at `width`, each line reopening its colour. */
function wrapColoured(text, width, measure) {
  const lines = [];
  let line = "";
  let colour = "";
  let lineColour = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > width) {
      lines.push(lineColour + line);
      lineColour = colour;
      line = word;
    } else {
      line = candidate;
    }
    for (const match of word.matchAll(/<col=([0-9a-f]{6})>|<\/col>/gi)) colour = match[1] ? `<col=${match[1]}>` : "";
  }
  if (line) lines.push(lineColour + line);
  return lines;
}

/** Malignius's recipe (stage 60): the hand-broken lead-in, then the wrapped item sentence. */
function recipeLines(items, measure) {
  const list = items.length === 3 ? `${items[0]}, ${items[1]} and ${items[2]}` : "the items he named";
  return [
    `${red("Malignus Mortifer")} told me that I need to make a pair of`,
    `${BLUE}${red("Enchanted Secateurs")} to fight the ${red("Tanglefoot")}. To do this I will`,
    ...wrapColoured(`need to take ${RED}a pair of secateurs, ${list}${BLUE} to the ${red("Nature Spirit")}.`,
      RECIPE_WRAP_WIDTH, measure),
  ];
}

/**
 * The journal for a stage. `gardeners` is how many of the five have answered; `items` the three
 * recipe names. Not started is Ours (no capture or Wiki journal transcript has it).
 */
function buildLines({ stage, gardeners = 0, items = [], measure = (text) => text.replace(/<[^>]*>/g, "").length * 7 }) {
  if (stage <= 0) {
    return [
      "I can start this quest by speaking to",
      "<col=800000>Martin the Master Gardener</col> at the market in",
      "<col=800000>Draynor Village</col>.",
      "",
      "I need to have completed <col=800000>Lost City</col> and",
      "<col=800000>Nature Spirit</col>.",
    ];
  }
  if (stage < 20) return [...struck(MARTIN), ...GARDENER_PROGRESS[Math.min(gardeners, 5)]];
  if (stage < 30) return [...struck(MARTIN), ...FAIRIES];
  if (stage < 40) return [...struck(GODFATHER), ...SEE_NUFF];
  if (stage < 50) return [...struck(GODFATHER), ...SEE_ZANDAR];
  if (stage < 60) return [...struck(GODFATHER), ...struck(SAW_ZANDAR), ...SEE_MALIGNIUS];
  const done = [...struck(GODFATHER), ...struck(SAW_ZANDAR), ...struck(SAW_MALIGNIUS)];
  if (stage < 70) return [...done, ...recipeLines(items, measure)];
  if (stage < 80) return [...done, ...ENCHANTED];
  if (stage < 90) return [...done, ...struck(USED_SECATEURS), ...RETURN_SECATEURS];
  return [
    ...struck(GODFATHER), ...struck(SAW_ZANDAR_DONE), ...struck(SAW_MALIGNIUS),
    ...struck(USED_SECATEURS), ...struck(RETURNED_SECATEURS),
    "<col=ff0000>QUEST COMPLETE!",
  ];
}

module.exports = { buildLines, wrapColoured, RECIPE_WRAP_WIDTH };
