import { Player } from "../../../entity/impl/player/Player";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { PluginManager } from "../../../../plugins/PluginManager";

/**
 * The quest each locked spellbook needs, shared by every way into a book: the altars, the magic cape, the Arcane
 * Grimoire and Lunar's Spellbook Swap. Wiki: the POH altars switch only when "they have the requirements to access
 * those spellbooks" (Occult altar; the Lunar altar names Lunar Diplomacy), the magic cape "to any spellbook they have
 * unlocked": Desert Treasure I for the Ancients, Lunar Diplomacy for the Lunars. The Arceuus book needs Tyss instead
 * (arceuusLocked below).
 */
export const SPELLBOOK_QUESTS: ReadonlyMap<MagicSpellbook, { key: string; name: string }> = new Map([
    [MagicSpellbook.ANCIENT, { key: "desert_treasure_i", name: "Desert Treasure I" }],
    [MagicSpellbook.LUNAR, { key: "lunar_diplomacy", name: "Lunar Diplomacy" }],
]);

/** The quest `book` needs that the player hasn't completed, or null when the book is open to them. */
export function lockingQuest(player: Player, book: MagicSpellbook): { key: string; name: string } | null {
    if (PluginManager.getPluginConfig<boolean>("quests:equipment-requirements", true) === false) return null;
    const quest = SPELLBOOK_QUESTS.get(book);
    if (!quest) return null;
    const query = { player, key: quest.key, complete: false };
    PluginManager.emitCustomEvent("quest:is-complete", query);
    return query.complete === true ? null : quest;
}

/**
 * Wiki (Arceuus spellbook): "accessing the spellbook now requires simply speaking to Tyss". The cache's
 * `arceuus_spellbook_unlocked` proc carries the refusal, captured as a message box on a Spellbook Swap quick pick
 * (rsprox_transcripts/227/00086.txt).
 */
export const ARCEUUS_LOCKED_MESSAGE = "You need to speak to Tyss at the Dark Altar to use Arceuus magic.";

/** Asked of the plugins (plugins/npcs/Tyss.plugin.js answers): `unlocked` is set true once the player has spoken to Tyss. */
export const ARCEUUS_UNLOCK_QUERY_EVENT = "arceuus:is-spellbook-unlocked";

/** True when `book` is the Arceuus spellbook and the player hasn't spoken to Tyss yet. */
export function arceuusLocked(player: Player, book: MagicSpellbook): boolean {
    if (book !== MagicSpellbook.ARCEUUS) return false;
    if (PluginManager.getPluginConfig<boolean>("quests:equipment-requirements", true) === false) return false;
    const query = { player, unlocked: false };
    PluginManager.emitCustomEvent(ARCEUUS_UNLOCK_QUERY_EVENT, query);
    return query.unlocked !== true;
}

/** True when the player may switch to `book`: its quest done, and Tyss spoken to for the Arceuus book. */
export function spellbookOpen(player: Player, book: MagicSpellbook): boolean {
    return lockingQuest(player, book) === null && !arceuusLocked(player, book);
}

/** The refusal for a locked book (TSPS wording for a quest; Spellbook Swap has a captured line of its own), or null. */
export function spellbookLockedRefusal(player: Player, book: MagicSpellbook): string | null {
    const quest = lockingQuest(player, book);
    if (quest) return `You need to complete ${quest.name} to use that spellbook.`;
    return arceuusLocked(player, book) ? ARCEUUS_LOCKED_MESSAGE : null;
}
