import { GraphicHeight } from "../GraphicHeight";
import { Priority } from "../Priority";
import { Graphic } from "../Graphic";
import { Animation } from "../Animation";
import { Sound } from "../../Sound";

/** What some teleports do besides their animations (from OSRS captures). */
export interface TeleportTypeOptions {
    /** Played on the cast instead of the spell teleport sound. */
    sound?: Sound;
    /** Varbit busy (12393) is 1 from the cast until arrival. */
    busy?: boolean;
    /** The end animation is sent again the tick after arrival. */
    repeatEndAnimation?: boolean;
}

/** An animation with both a client delay and a priority. */
function delayed(id: number, delay: number, priority: Priority): Animation {
    const animation = new Animation(id, delay);
    animation.priority = priority;
    return animation;
}

export class TeleportType {
    // Spellbooks
    // Standard spellbook teleport, also jewellery and the skull sceptre, as in rsprox captures
    // (Varrock Teleport, necklace of passage; docs/teleport-tablets.md): human_castteleport (714)
    // with teleport_casting (111) at height 92 and the teleport sound on the cast, busy until
    // landing on tick 3 with the animation reset, and the reset again a tick later. 111's own
    // sequence (667) leads in before the bubble, so the bubble follows the arms by itself.
    // TeleportTask runs step 0 on the click and step n on the click's tick + n (the task pass
    // runs before packets), so start tick 3 lands on tick 3.
    public static readonly NORMAL = new TeleportType(
        3,
        new Animation(714, Priority.HIGH),
        null,
        Animation.DEFAULT_RESET_ANIMATION,
        new Graphic(111, 0, 92 as GraphicHeight),
        null,
        null,
        { busy: true, repeatEndAnimation: true },
    );
    public static readonly ANCIENT = new TeleportType(5, new Animation(1979, Priority.HIGH), null, Animation.DEFAULT_RESET_ANIMATION, new Graphic(392, GraphicHeight.LOW, Priority.HIGH), null, null);
    public static readonly LUNAR = new TeleportType(4, new Animation(1816, Priority.HIGH), null, new Animation(715, Priority.HIGH), new Graphic(308, GraphicHeight.LOW, Priority.HIGH), null, null);
    public static readonly ARCEUUS = new TeleportType(4, new Animation(1816, Priority.HIGH), null, new Animation(715, Priority.HIGH), new Graphic(747, GraphicHeight.HIGH, Priority.HIGH), null, null);
    // Ladders
    public static readonly LADDER_DOWN = new TeleportType(1, new Animation(827, Priority.HIGH), null, Animation.DEFAULT_RESET_ANIMATION, null, null, null);
    public static readonly LADDER_UP = new TeleportType(1, new Animation(828, Priority.HIGH), null, Animation.DEFAULT_RESET_ANIMATION, null, null, null);
    // Misc
    public static readonly LEVER = new TeleportType(3, new Animation(2140, Priority.HIGH), new Animation(714), new Animation(715, Priority.HIGH), null, new Graphic(308, 0, GraphicHeight.HIGH), null);
    /**
     * Teleport tablets, as in an OSRS capture (docs/teleport-tablets.md): the tablet is smashed
     * (4069, sound 965), absorbed two ticks later (4071 and spotanim 678), and the player lands
     * on the fourth tick. TeleportTask runs step 0 when the click is handled and step n on the
     * click's tick + n (World.process runs the task pass before packets): start tick 4 lands on
     * the fourth tick, and the middle step (4 - 2) on the second.
     */
    public static readonly TELE_TAB = new TeleportType(
        4,
        delayed(4069, 16, Priority.HIGH),
        new Animation(4071, Priority.HIGH),
        Animation.DEFAULT_RESET_ANIMATION,
        null,
        new Graphic(678, GraphicHeight.LOW, Priority.HIGH),
        null,
        { sound: new Sound(965, 1, 15, 0), busy: true, repeatEndAnimation: true },
    );
    /**
     * Teleport scrolls, as in OSRS captures (docs/teleport-tablets.md): the scroll opens
     * (teleport_scroll_open 3864, telescroll_teleport 1039, the spell teleport sound) and is used
     * up on the click, and the player lands on the third tick (start tick 3, as above).
     */
    public static readonly TELE_SCROLL = new TeleportType(
        3,
        new Animation(3864, Priority.HIGH),
        null,
        Animation.DEFAULT_RESET_ANIMATION,
        new Graphic(1039, GraphicHeight.LOW, Priority.HIGH),
        null,
        null,
        { busy: true, repeatEndAnimation: true },
    );
    public static readonly PURO_PURO = new TeleportType(9, new Animation(6601, Priority.HIGH), null, Animation.DEFAULT_RESET_ANIMATION, new Graphic(1118, GraphicHeight.LOW, Priority.HIGH), null, null);

    private readonly startAnim: Animation;
    private readonly middleAnim: Animation;
    private readonly endAnim: Animation;
    private readonly startGraphic: Graphic;
    private readonly middleGraphic: Graphic;
    private readonly endGraphic: Graphic;
    private readonly startTick: number;
    private readonly options: TeleportTypeOptions;

    constructor(
        startTick: number,
        startAnim: Animation,
        middleAnim: Animation,
        endAnim: Animation,
        startGraphic: Graphic,
        middleGraphic: Graphic,
        endGraphic: Graphic,
        options: TeleportTypeOptions = {}
    ) {
        this.options = options;
        this.startTick = startTick;
        this.startAnim = startAnim;
        this.middleAnim = middleAnim;
        this.endAnim = endAnim;
        this.startGraphic = startGraphic;
        this.middleGraphic = middleGraphic;
        this.endGraphic = endGraphic;
    }

    getStartAnimation(): Animation {
        return this.startAnim;
    }

    getEndAnimation(): Animation {
        return this.endAnim;
    }

    getStartGraphic(): Graphic {
        return this.startGraphic;
    }

    getEndGraphic(): Graphic {
        return this.endGraphic;
    }

    getStartTick(): number {
        return this.startTick;
    }

    getMiddleAnim(): Animation {
        return this.middleAnim;
    }

    getMiddleGraphic(): Graphic {
        return this.middleGraphic;
    }

    getOptions(): TeleportTypeOptions {
        return this.options;
    }
}

