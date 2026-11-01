import { Priority } from "./Priority";

/**
 * How much an animation holds the character playing it (Wiki: Animation stall).
 * `full` blocks their actions and movement and stacks incoming hits until it ends;
 * `partial` only keeps a click from cutting the animation away - the true tile keeps
 * moving and the client catches up visually when it ends; `none` is not tracked.
 */
export type AnimationStallKind = "none" | "partial" | "full";

export class Animation {
    public static DEFAULT_RESET_ANIMATION: Animation;
    public id: number;
    public delay: number;
    public priority: Priority;

    constructor(id: number);
    constructor(id: number, delay: number);
    constructor(id: number, priority: Priority);
    constructor(id: number, delayOrPriority?: number | Priority) {
        this.id = id;
        if (
            delayOrPriority === Priority.LOW ||
            delayOrPriority === Priority.MEDIUM ||
            delayOrPriority === Priority.HIGH
        ) {
            this.delay = 0;
            this.priority = delayOrPriority;
        } else {
            this.delay = typeof delayOrPriority === "number" ? delayOrPriority : 0;
            this.priority = Priority.LOW;
        }
    }

    getId(): number {
        return this.id;
    }

    getDelay(): number {
        return this.delay;
    }

    getPriority() {
        return this.priority;
    }
}

// initialize static after enum exists
Animation.DEFAULT_RESET_ANIMATION = new Animation(65535);
