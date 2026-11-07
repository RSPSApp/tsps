function maxCharactersPerAccount(api) {
  // Older browser hosts do not checkpoint account ownership and profile deletions.
  if (process.env.BROWSER_HOST === "1" && process.env.BROWSER_HOST_ACCOUNT_PERSISTENCE !== "1") return 1;
  const configured = Math.floor(Number(api.getPluginConfig("characters:maxPerAccount", 6)));
  return Number.isFinite(configured) ? Math.min(6, Math.max(1, configured)) : 6;
}

/**
 * The name a character logs in as: the capitals its save was first made with when the save names
 * it, else `fallback` (the account record's name, or the typed one at login).
 */
function characterDisplayName(api, name, save, fallback = name) {
  const { Misc } = api.core;
  const saved = String(save?.getDisplayName?.() ?? "");
  return saved && Misc.formatNameForProtocol(saved) === Misc.formatNameForProtocol(name) ? saved : fallback;
}

/**
 * The characters as the picker shows them, each read from its save for `profile`. A save that
 * can't be read lists that character as one without a save rather than failing the whole list.
 */
function characterListFor(api, characters, profile) {
  const { GameConstants, SkillManager, Skills } = api.core;
  return characters.map((character, index) => {
    let save = null;
    try {
      save = GameConstants.PLAYER_PERSISTENCE.load(character.name, profile) ?? null;
    } catch (error) {
      console.error(`[login] failed to load ${character.name} for the character list`, error);
    }
    // A character with no (readable) save is shown as a new player.
    const levels = save?.getSkills?.()?.maxLevel ?? new Skills().maxLevel;
    let totalLevel = 0;
    for (let i = 0; i < SkillManager.AMOUNT_OF_SKILLS; i++) totalLevel += Number(levels[i]) || 0;
    return {
      name: characterDisplayName(api, character.name, save),
      combatLevel: SkillManager.calculateCombatLevel(levels),
      totalLevel,
      lastPlayedAt: character.lastPlayedAt,
      primary: index === 0,
      hasSave: save != null,
    };
  });
}

/**
 * The character a login enters without a choice: the typed one (see `enterTyped`), else the last
 * played, else the primary, skipping banned characters. -1 when every character is banned.
 */
function defaultCharacterIndex(
  api, characters,
  typedKey,
  { enterTyped = false, banned = () => false } = {},
) {
  const { Accounts } = api.core;
  const typed = characters.findIndex((character) => Accounts.key(character.name) === Accounts.key(typedKey));
  if (typed >= 0 && (typed > 0 || enterTyped) && !banned(characters[typed].name)) return typed;
  let best = -1;
  for (let i = 0; i < characters.length; i++) {
    if (banned(characters[i].name)) continue;
    if (best < 0 || characters[i].lastPlayedAt > characters[best].lastPlayedAt) best = i;
  }
  return best;
}

module.exports = { maxCharactersPerAccount, characterDisplayName, characterListFor, defaultCharacterIndex };
