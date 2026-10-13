"use strict";

/** Rolled once per bot and kept in the roster, so a bot stays the same person across sessions. */
const TEMPERAMENTS = [
  "laid-back and friendly",
  "competitive and a bit cocky",
  "goofy, likes a joke",
  "quiet, answers briefly",
  "a returning player who compares everything to how the game used to be",
  "patient with new players",
  "grumpy but harmless",
  "chatty, asks people what they're up to",
];

const CHAT_STYLES = [
  "types in all lowercase",
  "says lol and ngl a lot",
  "barely uses punctuation",
  "makes the odd typo",
  "keeps replies very short",
  "uses OSRS slang (gz, ty, np, wc, ez)",
];

const FOCUSES = [
  "mostly into skilling",
  "mostly into combat",
  "trying to make money",
  "mostly here to hang out and chat",
  "levelling everything evenly",
];

const pick = (list, random) => list[Math.floor(random() * list.length)];

function rollPersona(random = Math.random) {
  const first = pick(CHAT_STYLES, random);
  let second = pick(CHAT_STYLES, random);
  if (second === first) second = null;
  const style = second ? `${first}, ${second}` : first;
  return `${pick(TEMPERAMENTS, random)}; ${style}; ${pick(FOCUSES, random)}.`;
}

module.exports = { rollPersona };
