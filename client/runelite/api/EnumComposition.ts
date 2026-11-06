/** A cache enum (RuneLite's EnumComposition): int keys to int or string values. */
export interface EnumComposition {
    getId(): number;
    getKeys(): number[];
    getIntVals(): number[];
    getStringVals(): string[];
    /** The int value for a key, or the enum's default int when the key is absent. */
    getIntValue(key: number): number;
    /** The string value for a key, or the enum's default string when the key is absent. */
    getStringValue(key: number): string;
    size(): number;
}
