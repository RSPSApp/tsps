/** An item's cache definition, as far as ported plugins read it (RuneLite's ItemComposition). */
export interface ItemComposition {
    getId(): number;
    getName(): string;
    /** An int param, or -1 when the item has none by that key (RuneLite's getIntValue). */
    getIntValue(paramId: number): number;
    /** A string param, or "" when absent (RuneLite's getStringValue). */
    getStringValue(paramId: number): string;
    /** The noted/unnoted or placeholder counterpart id (RuneLite's getLinkedNoteId), -1 when none. */
    getLinkedNoteId(): number;
    getNote(): number;
    isStackable(): boolean;
    isMembers(): boolean;
}
