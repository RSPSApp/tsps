import { GraphicHeight } from "./GraphicHeight";
import { Priority } from "./Priority";
export class Graphic {
    public id: number;
    public delay: number;
    public height: GraphicHeight;
    public priority: Priority;

    constructor(id: number);
    /**
     * @deprecated The value decides what it is: 0-2 read as a Priority, a GraphicHeight value (50, 92, 96, 100,
     * 124) as a height, anything else as a delay. Use `Graphic.delayed(id, delay)`.
     */
    constructor(id: number, delay: number);
    /** @deprecated A height outside GraphicHeight reads as a delay. Use `Graphic.atHeight(id, height)`. */
    constructor(id: number, height: GraphicHeight);
    constructor(id: number, delay: number, height: GraphicHeight);
    constructor(id: number, priority: Priority);
    constructor(id: number, height: GraphicHeight, priority: Priority);
    constructor(id: number, delayOrHeight?: number, heightArg?: number) {
        this.id = id;
        if (
            typeof heightArg === "number" &&
            (heightArg === Priority.LOW ||
                heightArg === Priority.MEDIUM ||
                heightArg === Priority.HIGH)
        ) {
            this.delay = 0;
            this.height = typeof delayOrHeight === "number" ? (delayOrHeight as GraphicHeight) : GraphicHeight.LOW;
            this.priority = heightArg as Priority;
            return;
        } else if (typeof heightArg === "number") {
            this.delay = typeof delayOrHeight === "number" ? delayOrHeight : 0;
            this.height = heightArg as GraphicHeight;
        } else if (
            delayOrHeight === Priority.LOW ||
            delayOrHeight === Priority.MEDIUM ||
            delayOrHeight === Priority.HIGH
        ) {
            this.delay = 0;
            this.height = GraphicHeight.LOW;
            this.priority = delayOrHeight as Priority;
            return;
        } else if (typeof delayOrHeight === "number" && delayOrHeight in GraphicHeight) {
            this.delay = 0;
            this.height = delayOrHeight as GraphicHeight;
        } else if (typeof delayOrHeight === "number") {
            this.delay = delayOrHeight;
            this.height = GraphicHeight.LOW;
        } else {
            this.delay = 0;
            this.height = GraphicHeight.LOW;
        }
        this.priority = Priority.LOW;
    }

    /** A graphic `delay` client cycles late, at `height` (ground level by default). No value is reinterpreted. */
    public static delayed(id: number, delay: number, height: GraphicHeight | number = GraphicHeight.LOW): Graphic {
        const graphic = new Graphic(id);
        graphic.delay = delay;
        graphic.height = height as GraphicHeight;
        return graphic;
    }

    /** A graphic at `height`, `delay` client cycles late (none by default). No value is reinterpreted. */
    public static atHeight(id: number, height: GraphicHeight | number, delay = 0): Graphic {
        return Graphic.delayed(id, delay, height);
    }

    /** A delayed copy retains the graphic's height and priority without numeric overload ambiguity. */
    public withDelay(delay: number): Graphic {
        const copy = new Graphic(this.id);
        copy.delay = delay;
        copy.height = this.height;
        copy.priority = this.priority;
        return copy;
    }

    public getId(): number {
        return this.id;
    }

    /**
* Gets the graphic's wait delay.
*
* @return delay.
*/
    public getDelay(): number {
        return this.delay;
    }

    /**
     * Gets the graphic's height level to be displayed in.
     *
     * @return The height level.
     */
    public getHeight(): GraphicHeight {
        return this.height;
    }

    /**
     * Gets the priority of this graphic.
     *
     * @return the priority.
     */
    public getPriority(): Priority {
        return this.priority;
    }
}
