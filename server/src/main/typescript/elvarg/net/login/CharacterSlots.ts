import { GameConstants } from "../../game/GameConstants";
import { Accounts, type AccountCharacter } from "../../game/entity/impl/player/Accounts";
import type { PlayerProfile } from "../../game/entity/impl/player/persistence/PlayerProfile";
import { SkillManager, Skills } from "../../game/content/skill/SkillManager";
import { PluginManager } from "../../plugins/PluginManager";
import { Misc } from "../../util/Misc";
import type { CharacterListEntry } from "../protocol/ClientProtocol";

/** Characters per account by default (pluginConfig `characters:maxPerAccount`). */
const DEFAULT_MAX_CHARACTERS = 1;
/** The picker draws at most this many legible rows. */
const MAX_CHARACTERS_LIMIT = 6;

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

/**
 * The characters as the picker shows them, each read from its save for `profile`. A save that
 * can't be read lists that character as one without a save rather than failing the whole list.
 */
export function characterListFor(characters: AccountCharacter[], profile: PlayerProfile): CharacterListEntry[] {
  return characters.map((character, index) => {
    let save: any | null = null;
    try {
      save = GameConstants.PLAYER_PERSISTENCE.load(character.name, profile) ?? null;
    } catch (error) {
      console.error(`[login] failed to load ${character.name} for the character list`, error);
    }
    // A character with no (readable) save is shown as a new player.
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

export interface DefaultCharacterOptions {
  /**
   * The typed character enters even when it is the primary: a login without the picker
   * (LOGIN_FLAG_CHARACTER_SELECT) has no other way to reach it. With the picker only a typed
   * non-primary is preselected; a typed primary gives way to the last played.
   */
  enterTyped?: boolean;
  /** Characters that can't enter (banned) are never the default. */
  banned?: (name: string) => boolean;
}

/**
 * The character a login enters without a choice: the typed one (see `enterTyped`), else the last
 * played, else the primary, skipping banned characters. -1 when every character is banned.
 */
export function defaultCharacterIndex(
  characters: AccountCharacter[],
  typedKey: string,
  { enterTyped = false, banned = () => false }: DefaultCharacterOptions = {},
): number {
  const typed = characters.findIndex((character) => Accounts.key(character.name) === Accounts.key(typedKey));
  if (typed >= 0 && (typed > 0 || enterTyped) && !banned(characters[typed].name)) return typed;
  let best = -1;
  for (let i = 0; i < characters.length; i++) {
    if (banned(characters[i].name)) continue;
    if (best < 0 || characters[i].lastPlayedAt > characters[best].lastPlayedAt) best = i;
  }
  return best;
}
