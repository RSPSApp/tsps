export class SkullType {
    public static readonly WHITE_SKULL = new SkullType(0);
    public static readonly RED_SKULL = new SkullType(1);
    public static readonly LOOT_KEYS_ONE = new SkullType(8);
    public static readonly LOOT_KEYS_TWO = new SkullType(9);
    public static readonly LOOT_KEYS_THREE = new SkullType(10);
    public static readonly LOOT_KEYS_FOUR = new SkullType(11);
    public static readonly LOOT_KEYS_FIVE = new SkullType(12);

    iconId: number;

    constructor(iconId: number) {
        this.iconId = iconId;
    }

    public getIconId(): number {
        return this.iconId;
    }

    public static getForKeys(count: number): SkullType | null {
        if (!Number.isInteger(count) || count <= 0) return null;
        switch (Math.min(5, count)) {
            case 1: return SkullType.LOOT_KEYS_ONE;
            case 2: return SkullType.LOOT_KEYS_TWO;
            case 3: return SkullType.LOOT_KEYS_THREE;
            case 4: return SkullType.LOOT_KEYS_FOUR;
            default: return SkullType.LOOT_KEYS_FIVE;
        }
    }
}