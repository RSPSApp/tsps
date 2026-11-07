import * as InterfaceID from "@runelite/api/gameval/InterfaceID";

/**
 * The interface components the plugin reads. The generated InterfaceID carries group ids only, so
 * each child index is from the cache's component names (rev 241), named beside it.
 */
const component = (group: number, child: number): number => (group << 16) | child;

/** trail_cluetext:text — the clue's text when a scroll is read. */
export const TRAIL_CLUETEXT_TEXT = component(InterfaceID.TRAIL_CLUETEXT, 2);
/** objectbox:item — the item shown in a chatbox item dialogue ("You've been given a clue"). */
export const OBJECTBOX_ITEM = component(InterfaceID.OBJECTBOX, 1);

/** emote:universe, emote:scrollable, emote:contents, emote:scrollbar. */
export const EMOTE_UNIVERSE = component(InterfaceID.EMOTE, 0);
export const EMOTE_SCROLLABLE = component(InterfaceID.EMOTE, 1);
export const EMOTE_CONTENTS = component(InterfaceID.EMOTE, 2);
export const EMOTE_SCROLLBAR = component(InterfaceID.EMOTE, 4);

/** music:universe, music:scrollable, music:jukebox, music:scrollbar. */
export const MUSIC_UNIVERSE = component(InterfaceID.MUSIC, 0);
export const MUSIC_SCROLLABLE = component(InterfaceID.MUSIC, 9);
export const MUSIC_JUKEBOX = component(InterfaceID.MUSIC, 11);
export const MUSIC_SCROLLBAR = component(InterfaceID.MUSIC, 12);

/** The beginner map interface groups, TRAIL_MAP01 to TRAIL_MAP11. */
export const TRAIL_MAP_FIRST = InterfaceID.TRAIL_MAP01;
export const TRAIL_MAP_LAST = InterfaceID.TRAIL_MAP11;
