export class Skill {
    // Must be initialized before any static Skill instances are constructed.
    // If declared after ATTACK/DEFENCE/etc, indices become NaN and all skill
    // lookups/packets collapse to zero.
    private static nextIndex = 0;

    public static ATTACK = new Skill(6247, 8654);
    public static DEFENCE = new Skill(6253, 8660);
    public static STRENGTH = new Skill(6206, 8657);
    public static HITPOINTS = new Skill(6216, 8655);
    public static RANGED = new Skill(4443, 8663);
    public static PRAYER = new Skill(6242, 8666);
    public static MAGIC = new Skill(6211, 8669);
    public static COOKING = new Skill(6226, 8665);
    public static WOODCUTTING = new Skill(4272, 8671);
    public static FLETCHING = new Skill(6231, 8670);
    public static FISHING = new Skill(6258, 8662);
    public static FIREMAKING = new Skill(4282, 8668);
    public static CRAFTING = new Skill(6263, 8667);
    public static SMITHING = new Skill(6221, 8659);
    public static MINING = new Skill(4416, 8656);
    public static HERBLORE = new Skill(6237, 8661);
    public static AGILITY = new Skill(4277, 8658);
    public static THIEVING = new Skill(4261, 8664);
    public static SLAYER = new Skill(12122, 12162);
    public static FARMING = new Skill(5267, 13928);
    public static RUNECRAFTING = new Skill(4267, 8672);
    public static CONSTRUCTION = new Skill(7267, 18801, 22);
    public static HUNTER = new Skill(8267, 18829, 21);
    // No legacy level-up chatbox or skills tab button; client stat 23 as in OSRS.
    public static SAILING = new Skill(-1, -1, 23);

    private static readonly VALUES: Skill[] = [
        Skill.ATTACK,
        Skill.DEFENCE,
        Skill.STRENGTH,
        Skill.HITPOINTS,
        Skill.RANGED,
        Skill.PRAYER,
        Skill.MAGIC,
        Skill.COOKING,
        Skill.WOODCUTTING,
        Skill.FLETCHING,
        Skill.FISHING,
        Skill.FIREMAKING,
        Skill.CRAFTING,
        Skill.SMITHING,
        Skill.MINING,
        Skill.HERBLORE,
        Skill.AGILITY,
        Skill.THIEVING,
        Skill.SLAYER,
        Skill.FARMING,
        Skill.RUNECRAFTING,
        Skill.CONSTRUCTION,
        Skill.HUNTER,
        Skill.SAILING,
    ];
    private static readonly NAMES: readonly string[] = [
        "Attack",
        "Defence",
        "Strength",
        "Hitpoints",
        "Ranged",
        "Prayer",
        "Magic",
        "Cooking",
        "Woodcutting",
        "Fletching",
        "Fishing",
        "Firemaking",
        "Crafting",
        "Smithing",
        "Mining",
        "Herblore",
        "Agility",
        "Thieving",
        "Slayer",
        "Farming",
        "Runecrafting",
        "Construction",
        "Hunter",
        "Sailing",
    ];

    private static readonly ALLOWED_TO_SET_LEVELS: ReadonlySet<Skill> = new Set([
        Skill.ATTACK,
        Skill.DEFENCE,
        Skill.STRENGTH,
        Skill.HITPOINTS,
        Skill.RANGED,
        Skill.PRAYER,
        Skill.MAGIC
    ]);

    private static readonly skillMap: Map<number, Skill> = new Map<number, Skill>(
        Skill.VALUES.map((skill) => [skill.button, skill] as [number, Skill])
    );

    /**
     * The {@link Skill}'s chatbox interface
     * The interface which will be sent
     * on levelup.
     */
    private readonly chatboxInterface: number;
    /**
     * The {@link Skill}'s button in the skills tab
     * interface.
     */
    private readonly button: number;
    /**
     * Stable index used for skill arrays (equivalent to Java enum ordinal).
     */
    private readonly index: number;

    /**
     * Constructor
     *
     * @param chatboxInterface
     * @param button
     */
    constructor(chatboxInterface: number, button: number, private readonly clientId?: number) {
        this.chatboxInterface = chatboxInterface;
        this.button = button;
        if (!Number.isInteger(Skill.nextIndex)) {
            Skill.nextIndex = 0;
        }
        this.index = Skill.nextIndex++;
    }

    /**
     * Gets a skill for its button id.
     *
     * @param button The button id.
     * @return The skill with the matching button.
     */
    public static forButton(button: number): Skill | undefined {
        return Skill.skillMap.get(button);
    }

    public static values(): Skill[] {
        return Skill.VALUES;
    }

    public canSetLevel() {
        return Skill.ALLOWED_TO_SET_LEVELS.has(this);
    }

    /**

    Gets the {@link Skill}'s chatbox interface.
    @return The interface which will be sent on levelup.
    */
    public getChatboxInterface(): number {
        return this.chatboxInterface;
    }
    /**

    Gets the {@link Skill}'s button id.
    @return The button for this skill.
    */
    public getButton(): number {
        return this.button;
    }

    /**
     * Gets the array index for this skill.
     * Use this for level/maxLevel/experience arrays, not button ids.
     */
    public getIndex(): number {
        return this.index;
    }

    // Saved arrays predate OSRS's Hunter/Construction order. Keep their indices
    // stable and translate only when sending skill IDs to the client.
    public getClientId(): number {
        return this.clientId ?? this.index;
    }
    /**

    Gets the {@link Skill}'s name.
    @return The {@link Skill}'s name in a suitable format.
    */
    public getName(): string {
        return Skill.NAMES[this.index] ?? "Skill";
    }
}
