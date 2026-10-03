/**
 * Warriors' Guild: Shanomi's and Kamfreena's overhead sayings, from their Wiki transcripts.
 * Shanomi says hers in order every 15 ticks; Kamfreena picks one at random every 50.
 */
const Guild = require("./Common.WarriorsGuild");

const SHANOMI_EVERY = 15;
const SHANOMI_LINES = [
  "Think not dishonestly.",
  "The Way in training is.",
  "Acquainted with every art become.",
  "Ways of all professions know you.",
  "Gain and loss between you must distinguish.",
  "Judgment and understanding for everything develop you must.",
  "Those things which cannot be seen, perceive them.",
  "Trifles pay attention even to.",
  "Do nothing which is of no use.",
  "Way of the Warrior this is.",
];
const KAMFREENA_EVERY = 50;
const KAMFREENA_LINES = [
  "Life isn't fair, that doesn't mean you can't win.",
  "Be master of your mind rather than mastered by your mind.",
  "A reflection on a pool of water does not reveal its depth.",
  "When you aim for perfection, you discover it's a moving target.",
  "He who speaks in anger makes his anger heard, but his words forgotten.",
  "Patience and persistence can bring down the tallest trees.",
];

const speakers = new Map();
let ticks = 0;
let shanomiLine = 0;

function speaker(npcId) {
  const known = speakers.get(npcId);
  if (known?.isRegistered()) return known;
  const npc = Guild.core.World.getNpcs().search((candidate) => candidate?.getId() === npcId);
  speakers.set(npcId, npc);
  return npc;
}

function chatter() {
  ticks++;
  if (ticks % SHANOMI_EVERY === 0) {
    speaker(Guild.NPCS.SHANOMI)?.forceChat(SHANOMI_LINES[shanomiLine++ % SHANOMI_LINES.length]);
  }
  if (ticks % KAMFREENA_EVERY === 0) {
    speaker(Guild.NPCS.KAMFREENA)?.forceChat(KAMFREENA_LINES[Guild.random(0, KAMFREENA_LINES.length - 1)]);
  }
}

function start() {
  Guild.every(null, chatter);
}

module.exports = function attachChatter(api) {
  api.onServerStartup(start);
};
