/** RuneLite's MenuAction opcodes that plugins use for their own right-click entries. */
export const MenuAction = {
    /** An overlay's own right-click entry (RuneLite's RUNELITE_OVERLAY). */
    RUNELITE_OVERLAY: 1501,
    /** An overlay's "Configure" entry (RuneLite's RUNELITE_OVERLAY_CONFIG). */
    RUNELITE_OVERLAY_CONFIG: 1502,
} as const;

export type MenuAction = (typeof MenuAction)[keyof typeof MenuAction];
