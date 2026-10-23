export enum MenuTargetType {
    NONE,
    PLAYER,
    NPC,
    LOC,
    OBJ,
    ITEM, // inventory items
    WORLD_ENTITY,
}

export interface MenuEntry {
    option: string;
    targetId: number;
    targetType: MenuTargetType;
    targetName: string;
    targetLevel: number;
}

// UI-facing menu entry used by both the legacy CSS menu and the WebGL Choose Option overlay.
// Keep this colocated with core menu types so renderers can depend on it without importing UI components.
export interface SpellCastMetadata {
    spellId: number;
    spellName: string;
    spellLevel?: number;
    runes?: Array<{ itemId: number; quantity: number }>;
    // Optional contextual data to help the renderer/client resolve precise targets
    mapX?: number;
    mapY?: number;
    npcServerId?: number;
    playerServerId?: number;
}

export interface OsrsMenuEntry extends MenuEntry {
    // Optional native mouse event to allow screen-position-based effects (click cross, etc.)
    onClick?: (entry?: MenuEntry, e?: MouseEvent, ctx?: unknown) => void;
    // Optional coordinates captured when building the entry
    tile?: { tileX: number; tileY: number; plane?: number };
    mapX?: number;
    mapY?: number;
    // Index of the option in the underlying action list (0-based). Helps compute real opcodes.
    actionIndex?: number;
    // When known, the exact client opcode for this menu entry (matches OSRS client ids).
    opcode?: number;
    // Optional player server id target (for player interactions)
    playerServerId?: number;
    // Optional NPC server id target (for NPC interactions)
    npcServerId?: number;
    // When present, indicates this entry should cast a spell instead of the standard interaction.
    spellCast?: SpellCastMetadata;
    // Whether this entry is deprioritized (sorted below normal entries, e.g., Attack when set to right-click only)
    deprioritized?: boolean;
    /** True when this menu option invokes combat rather than an NPC interaction. */
    isAttack?: boolean;
}
