/** A loc's cache definition (RuneLite's ObjectComposition). */
export interface ObjectComposition {
    getId(): number;
    getName(): string;
    getActions(): ReadonlyArray<string | null | undefined>;
    /** The multiloc's forms, or null for a plain loc (RuneLite's getImpostorIds). */
    getImpostorIds(): number[] | null;
    /**
     * The form the player's vars select now (RuneLite's getImpostor). Null for a plain loc or a
     * form that is hidden (-1).
     */
    getImpostor(): ObjectComposition | null;
    getSizeX(): number;
    getSizeY(): number;
}
