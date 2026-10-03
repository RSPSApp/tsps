export class Sound {

    // OSRS synth IDs: RuneLite SoundEffectID / RuneStar synth names.
    // Mining, fishing, fletching and anvil sequences already contain frame audio;
    // callers must not send these effects again for those animations.

    // crafting sounds

    public static CUTTING = new Sound(2605, 1, 0, 0)

    public static SHEAR_SHEEP = new Sound(761, 1, 0, 0)

    // cooking sounds

    public static COOKING_COOK = new Sound(2577, 1, 0, 0)

    // runecrafting sounds

    // OSRS bind_runes; 207 belongs to waterblast, not skilling.
    public static CRAFT_RUNES = new Sound(2710, 1, 0, 0)

    // mining sounds

    public static MINING_MINE = new Sound(3220, 1, 0, 0)

    // fishing sounds

    public static FISHING_FISH = new Sound(2600, 1, 0, 0)

    // woodcutting sounds

    // No explicit WOODCUTTING_CHOP: every axe swing animation has sound 2735 baked
    // into frame 3 in the cache, so the client already plays it when the animation
    // renders - an explicit server send here was a duplicate, out-of-phase trigger.

    public static WOODCUTTING_TREE_DOWN = new Sound(2734, 1, 0, 0)

    // Getting hit
    public static PLAYER_GETTING_HIT = new Sound(513, 1, 0, 0)
    public static DEFENCE_BLOCK = new Sound(511, 1, 0, 0)

    // weapon sounds

    public static NPC_ATTACKING = new Sound(394, 1, 0, 0)
    public static IMP_ATTACKING = Sound.NPC_ATTACKING

    public static SHOOT_ARROW = new Sound(2702, 1, 0, 0)
    public static SHOOT_CROSSBOW = new Sound(2695, 1, 0, 0)
    public static SHOOT_BOW_QUIET = new Sound(2700, 1, 0, 0)
    public static THROW_DART = new Sound(2696, 1, 0, 0)

    public static WEAPON = new Sound(2567, 1, 0, 0) // default/other

    public static WEAPON_GODSWORD = new Sound(3847, 1, 0, 0)

    public static WEAPON_STAFF = new Sound(2556, 1, 0, 0)

    public static WEAPON_BOW = Sound.SHOOT_ARROW

    public static WEAPON_BATTLE_AXE = new Sound(2498, 1, 0, 0)

    public static WEAPON_TWO_HANDER = new Sound(2503, 1, 0, 0)

    public static WEAPON_SCIMITAR = new Sound(2500, 1, 0, 0)

    public static WEAPON_WHIP = new Sound(2720, 1, 0, 0)
    public static WEAPON_DAGGER_STAB = new Sound(2501, 1, 0, 0)
    public static WEAPON_DAGGER_SLASH = new Sound(2500, 1, 0, 0)
    public static WEAPON_DRAGON_DAGGER_STAB = Sound.WEAPON_DAGGER_STAB
    public static WEAPON_SWORD_STAB = new Sound(2501, 1, 0, 0)
    public static WEAPON_SWORD_SLASH = new Sound(2500, 1, 0, 0)
    public static WEAPON_MACE_STAB = new Sound(2509, 1, 0, 0)
    public static WEAPON_MACE_CRUSH = new Sound(2508, 1, 0, 0)
    public static WEAPON_WARHAMMER = new Sound(2567, 1, 0, 0)
    public static WEAPON_SPEAR_STAB = new Sound(2549, 1, 0, 0)
    public static WEAPON_SPEAR_SLASH = new Sound(2548, 1, 0, 0)
    public static WEAPON_SPEAR_CRUSH = new Sound(2547, 1, 0, 0)
    public static WEAPON_SCYTHE_STAB = new Sound(2525, 1, 0, 0)
    public static WEAPON_SCYTHE_SLASH = new Sound(2524, 1, 0, 0)
    public static WEAPON_UNARMED_PUNCH = new Sound(2566, 1, 0, 0)
    public static WEAPON_UNARMED_KICK = new Sound(2565, 1, 0, 0)
    public static WEAPON_DHAROK_GREATAXE = new Sound(1321, 1, 0, 0)
    public static WEAPON_VERAC_FLAIL = new Sound(1335, 1, 0, 0)
    public static WEAPON_GUTHAN_WARSPEAR = Sound.WEAPON_SPEAR_STAB
    public static WEAPON_TORAG_HAMMER = new Sound(1332, 1, 0, 0)
    public static WEAPON_GRANITE_MAUL = Sound.WEAPON_WARHAMMER

    // Special attack

    public static readonly DRAGON_DAGGER_SPECIAL = new Sound(2537, 1, 0, 0)
    public static readonly MAGIC_SHORTBOW_SPECIAL = new Sound(2545, 1, 0, 0)
    public static readonly DRAGON_MACE_SPECIAL = new Sound(2541, 1, 0, 0)
    public static readonly DRAGON_SPEAR_SPECIAL = new Sound(2544, 1, 0, 0)
    public static readonly DRAGON_BATTLEAXE_SPECIAL = new Sound(2530, 1, 0, 0)
    public static readonly DRAGON_LONGSWORD_SPECIAL = new Sound(2529, 1, 0, 0)
    public static readonly MAGIC_LONGBOW_SPECIAL = Sound.SHOOT_BOW_QUIET
    public static readonly WHIP_SPECIAL = new Sound(2713, 1, 0, 0)

    // Spell sounds

    public static SPELL_FAIL_SPLASH = new Sound(227, 1, 0, 0)
    public static TELEKINETIC_GRAB = new Sound(192, 1, 0, 0)
    public static HIGH_ALCHEMY = new Sound(97, 1, 0, 0)
    public static LOW_ALCHEMY = new Sound(98, 1, 0, 0)
    public static SUPERHEAT_ITEM = new Sound(190, 1, 0, 0)
    public static TELEPORT = new Sound(200, 1, 0, 0)

    public static ICE_BARRAGE_IMPACT = new Sound(168, 1, 0, 0)
    public static ICA_BARRAGE_IMPACT = Sound.ICE_BARRAGE_IMPACT // legacy alias
    public static BLOOD_BLITZ_CAST = new Sound(103, 1, 0, 0)
    public static ICE_BLITZ_CAST = new Sound(169, 1, 0, 0)

    public static DROP_ITEM = new Sound(2739, 1, 0, 0)
    public static PICK_UP_ITEM = new Sound(2582, 1, 0, 0)
    public static CONTAINER_OPEN = new Sound(2021, 1, 0, 0)
    public static CONTAINER_CLOSE = new Sound(326, 1, 0, 0)
    public static DOOR_OPEN = new Sound(62, 1, 0, 0)
    public static DOOR_CLOSE = new Sound(60, 1, 0, 0)
    public static GATE_OPEN = new Sound(67, 1, 0, 0)
    public static GATE_CLOSE = new Sound(66, 1, 0, 0)
    public static EQUIPMENT_ON = new Sound(358, 1, 0, 0)
    public static EQUIPMENT_OFF = new Sound(376, 1, 0, 0)

    public static FIRE_LIGHT = new Sound(2599, 1, 0, 0)
    public static FIRE_SUCCESSFUL = new Sound(2596, 1, 0, 0)
    public static FIRE_FIRST_ATTEMPT = new Sound(2584, 1, 0, 0)
    public static POTION_MIX = new Sound(2611, 1, 0, 0)
    public static SLASH_WEB = new Sound(237, 1, 0, 0)
    public static FAIL_SLASH_WEB = new Sound(2548, 1, 0, 0)
    public static FOOD_EAT = new Sound(2393, 1, 0, 0)
    public static DRINK = new Sound(2401, 1, 0, 0)
    public static PICK_LOCK = new Sound(2402, 1, 0, 0)
    public static GENIE_LAMP = new Sound(430, 1, 0, 0)
    public static BURY_BONES = new Sound(2738, 1, 0, 0)
    public static WILDERNESS_DITCH_JUMP = new Sound(2462, 1, 0, 0)
    public static THIEVING_STUNNED = new Sound(2727, 1, 0, 0)
    public static LEVEL_UP = new Sound(2396, 1, 0, 0)
    public static GEM_CUTTING = new Sound(2586, 1, 0, 0)
    public static SMITHING = new Sound(3790, 1, 0, 0)
    public static SMELTING = new Sound(2725, 1, 0, 0)
    public static PRAYER_DEPLETED = new Sound(2663, 1, 0, 0)
    public static PRAYER_PROTECT_MELEE = new Sound(2676, 1, 0, 0)
    public static PRAYER_SUPERHUMAN_STRENGTH = new Sound(2689, 1, 0, 0)
    public static PRAYER_TURN_OFF = new Sound(2663, 1, 0, 0)
    public static PRAYER_CLARITY_OF_THOUGHT = new Sound(2664, 1, 0, 0)
    public static PRAYER_PROTECT_MAGIC = new Sound(2675, 1, 0, 0)
    public static PRAYER_STEEL_SKIN = new Sound(2687, 1, 0, 0)
    public static PRAYER_INCREDIBLE_REFLEXES = new Sound(2667, 1, 0, 0)
    public static PRAYER_ROCK_SKIN = new Sound(2684, 1, 0, 0)
    public static PRAYER_RECHARGE = new Sound(2674, 1, 0, 0)
    public static PRAYER_RAPID_HEAL = new Sound(2678, 1, 0, 0)
    public static PRAYER_PROTECT_RANGE = new Sound(2677, 1, 0, 0)
    public static PRAYER_THICK_SKIN = new Sound(2690, 1, 0, 0)
    public static PRAYER_INSUFFICIENT = new Sound(447, 1, 0, 0)
    public static PRAYER_IMPROVED_REFLEXES = new Sound(2662, 1, 0, 0)
    public static PRAYER_BURST_OF_STRENGTH = new Sound(2688, 1, 0, 0)
    public static PRAYER_ULTIMATE_STRENGTH = new Sound(2691, 1, 0, 0)
    public static PRAYER_RAPID_RESTORE = new Sound(2679, 1, 0, 0)
    public static RUNECRAFTING = Sound.CRAFT_RUNES
    public static HOME_TELEPORT = new Sound(193, 1, 0, 0)
    public static HOME_TELEPORT_ALT = Sound.HOME_TELEPORT

    public id: number;
    public volume: number;
    public delay: number;

    public loopType: number;

    constructor(id: number, volume: number, delay: number, loopType: number) {

        this.id = id;
        this.volume = volume;
        this.delay = delay;
        this.loopType = loopType;
    }

    public getId(): number {
        return this.id;
    }

    public getVolume(): number {
        return this.volume;
    }

    public getClientVolume(): number {
        return Math.max(0, Math.min(10, this.volume));
    }

    public getDelay(): number {
        return this.delay;
    }

    public getLoopType(): number { return this.loopType; }

}
