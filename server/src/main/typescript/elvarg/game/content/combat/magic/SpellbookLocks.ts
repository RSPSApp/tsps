import { Player } from "../../../entity/impl/player/Player";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { PluginManager } from "../../../../plugins/PluginManager";

/**
 * The quest each locked spellbook needs, shared by every way into a book: the altars, the magic cape, the Arcane
 * Grimoire and Lunar's Spellbook Swap. Wiki: the POH altars switch only when "they have the requirements to access
 * those spellbooks" (Occult altar; the Lunar altar names Lunar Diplomacy), the magic cape "to any spellbook they have
 * unlocked": Desert Treasure I for the Ancients, Lunar Diplomacy for the Lunars.
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

/** The refusal for a locked book (TSPS wording; Spellbook Swap has a captured line of its own), or null. */
export function spellbookLockedRefusal(player: Player, book: MagicSpellbook): string | null {
    const quest = lockingQuest(player, book);
    return quest ? `You need to complete ${quest.name} to use that spellbook.` : null;
}
