/**
 * The Timers plugin's icons, shared by its canvas overlay (TimersInfoBoxOverlay) and the mobile
 * gameframe's HTML boxes (StatusTimerOverlay): cache sprite ids, or item ids for item icons, by the
 * timer's type.
 */
export const POISON_SPRITES: Record<number, number> = { 1: 1061, 2: 1102 };
export const FREEZE_SPRITES: Record<number, number> = {
    1572: 319,
    1582: 320,
    1592: 321,
    12861: 325,
    12881: 326,
    12871: 327,
    12891: 328,
};
// RuneLite GameTimer icons: antifire (normal and extended) and super antifire (normal and
// extended) are the 4-dose potions, teleblock is the spell sprite (Magicon2.TELE_BLOCK).
export const ANTIFIRE_ITEMS: Record<number, number> = { 1: 2452, 2: 21978 };
export const TELEBLOCK_SPRITES: Record<number, number> = { 1: 352 };
export const STAMINA_ITEMS: Record<number, number> = { 1: 12625 };
export const VENGEANCE_SPRITE_ID = 564;

// Sent by server/plugins/interface/BuffTimers.plugin.js.
export const ANTIFIRE_TIMER_SECONDS_VARP = 7990;
export const ANTIFIRE_TIMER_TYPE_VARP = 7991;
export const TELEBLOCK_TIMER_SECONDS_VARP = 7992;
export const STAMINA_TIMER_SECONDS_VARP = 7993;
/**
 * The other timed effects (divine potions, overloads, Menaphite remedy, prayer regeneration and
 * enhance, antipoison immunity, goading, the imbued heart's cooldown and hunter meat's second
 * heal): ITEM_TIMER_SLOTS pairs from ITEM_TIMER_FIRST_VARP, each the seconds left (0: empty)
 * and the item whose icon and name the timer shows.
 */
export const ITEM_TIMER_FIRST_VARP = 7970;
export const ITEM_TIMER_SLOTS = 10;
