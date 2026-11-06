import { GameConstants } from "../../game/GameConstants";
import { Accounts, type AccountCharacter } from "../../game/entity/impl/player/Accounts";
import type { PlayerProfile } from "../../game/entity/impl/player/persistence/PlayerProfile";
import { SkillManager, Skills } from "../../game/content/skill/SkillManager";
import { PluginManager } from "../../plugins/PluginManager";
import { Misc } from "../../util/Misc";
import type { CharacterListEntry } from "../protocol/ClientProtocol";

/** Characters per account by default (pluginConfig `characters:maxPerAccount`). */
const DEFAULT_MAX_CHARACTERS = 3;
const MAX_CHARACTERS_LIMIT = 20;

/**
 * How many characters one account may have. The in-browser host keeps no account file across
 * reloads, so it has one: a second character's save could outlive the record of who owns it.
 */
export function maxCharactersPerAccount(): number {
  if (process.env.BROWSER_HOST === "1") return 1;
  const configured = Math.floor(Number(PluginManager.getPluginConfig<number>("characters:maxPerAccount", DEFAULT_MAX_CHARACTERS)));
  if (!Number.isFinite(configured)) return DEFAULT_MAX_CHARACTERS;
  return Math.min(MAX_CHARACTERS_LIMIT, Math.max(1, configured));
}

/**
 * The name a character logs in as: the capitals its save was first made with when the save names
 * it, else `fallback` (the account record's name, or the typed one at login).
 */
export function characterDisplayName(name: string, save: any | null, fallback = name): string {
  const saved = String(save?.getDisplayName?.() ?? "");
  return saved && Misc.formatNameForProtocol(saved) === Misc.formatNameForProtocol(name) ? saved : fallback;
}

/** The account's characters as the picker shows them, each read from its save for `profile`. */
export function characterListFor(accountKey: string, profile: PlayerProfile): CharacterListEntry[] {
  return Accounts.charactersOf(accountKey).map((character, index) => {
    const save = GameConstants.PLAYER_PERSISTENCE.load(character.name, profile) ?? null;
    // A character with no save yet enters as a new player does.
    const levels: number[] = save?.getSkills?.()?.maxLevel ?? new Skills().maxLevel;
    let totalLevel = 0;
    for (let i = 0; i < SkillManager.AMOUNT_OF_SKILLS; i++) totalLevel += Number(levels[i]) || 0;
    return {
      name: characterDisplayName(character.name, save),
      combatLevel: SkillManager.calculateCombatLevel(levels),
      totalLevel,
      lastPlayedAt: character.lastPlayedAt,
      primary: index === 0,
      hasSave: save != null,
    };
  });
}

/** The character a login enters without a choice: the typed one, else the last played, else the primary. */
export function defaultCharacterIndex(characters: AccountCharacter[], typedKey: string): number {
  const typed = characters.findIndex((character) => Accounts.key(character.name) === Accounts.key(typedKey));
  if (typed > 0) return typed;
  let best = 0;
  for (let i = 1; i < characters.length; i++) {
    if (characters[i].lastPlayedAt > characters[best].lastPlayedAt) best = i;
  }
  return best;
}
