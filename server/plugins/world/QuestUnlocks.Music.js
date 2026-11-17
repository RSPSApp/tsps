/**
 * Quest-driven music unlocks, read from the cache's own unlock hints (DB table 44, column 2):
 * "during the Dragon Slayer II quest.", "during the General's Shadow miniquest.",
 * "after completing the While Guthix Sleeps and Dragon Slayer II quests." (both required),
 * "during The Heart of Darkness or Perilous Moons quest." (either).
 *
 * Live unlocks these the first time the track plays, somewhere inside the quest. A quest plugin
 * that knows the moment emits `music:unlock-track` itself; this module is the floor under that: a
 * player who completed the quest has heard its tracks, so completion (and login, for saves from
 * before) unlocks whatever is still locked. Hints naming quests the server has not got stay locked.
 */
const QUEST_HINT = /^(?:during|after completing) (?:the )?(.+?) (?:quest|miniquest|quests)\.?$/i;

/** Lower-case, no leading "The", punctuation folded to spaces: "Another Slice of H.A.M." == "...H.A.M". */
// Memoised: the names are the cache's hints and the registered quests, a fixed set, and each
// completion check normalises every hint name again for each quest.
const normalisedQuestNames = new Map();
function normaliseQuestName(name) {
  const key = String(name ?? "");
  let plain = normalisedQuestNames.get(key);
  if (plain === undefined) {
    plain = key
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    normalisedQuestNames.set(key, plain);
  }
  return plain;
}

/** The hint's quest names, or undefined for an area, boss, minigame or event hint. */
function parseQuestHint(hint) {
  const match = QUEST_HINT.exec(String(hint ?? "").trim());
  if (!match) return undefined;
  const names = (separator) => match[1].split(separator).map((name) => name.trim()).filter(Boolean);
  if (/ or /.test(match[1])) return { any: names(/ or /) };
  return { all: names(/ and /) };
}

/** Hint names the cache spells differently from the quest: "during The Digsite quest." is The Dig Site. */
const CACHE_QUEST_NAMES = { digsite: "The Dig Site" };

/**
 * The names a hint's quest may be registered under: "Observatory" is "Observatory Quest",
 * "Monkey Madness" (the first one's tracks) is "Monkey Madness I", "Digsite" is "The Dig Site".
 */
function questNameAliases(name) {
  const spelled = CACHE_QUEST_NAMES[normaliseQuestName(name)];
  return [name, `${name} Quest`, `${name} I`, ...(spelled ? [spelled] : [])];
}

/** Whether a hint's quest name means the registered quest `questName`. */
function hintNamesQuest(hintName, questName) {
  const quest = normaliseQuestName(questName);
  return questNameAliases(hintName).some((alias) => normaliseQuestName(alias) === quest);
}

/**
 * tracks: `core.Music.tracks()` rows ({ id, unlockHint }). Returns every quest-hinted track as
 * { trackId, requires: { all: [names] } | { any: [names] } } and the distinct quest names named.
 */
function questTracks(tracks) {
  const entries = [];
  const questNames = new Map();
  for (const track of tracks ?? []) {
    const requires = parseQuestHint(track.unlockHint);
    if (!requires) continue;
    entries.push({ trackId: track.id, requires });
    for (const name of requires.all ?? requires.any) {
      const key = normaliseQuestName(name);
      if (!questNames.has(key)) questNames.set(key, name);
    }
  }
  return { entries, questNames: [...questNames.values()] };
}

/** The entries a just-completed quest may unlock (the ones whose hint names it). */
function entriesForQuest(entries, questName) {
  return entries.filter(({ requires }) => (requires.all ?? requires.any).some((name) => hintNamesQuest(name, questName)));
}

/**
 * Whether an entry's requirement holds. `isComplete(hintName)` answers true, false, or undefined
 * for a quest the server has not got; an unknown quest never counts as complete.
 */
function requirementMet(requires, isComplete) {
  if (requires.any) return requires.any.some((name) => isComplete(name) === true);
  return requires.all.every((name) => isComplete(name) === true);
}

module.exports = {
  QUEST_HINT,
  CACHE_QUEST_NAMES,
  normaliseQuestName,
  parseQuestHint,
  questNameAliases,
  hintNamesQuest,
  questTracks,
  entriesForQuest,
  requirementMet,
};
