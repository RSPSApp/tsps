/**
 * Legacy (IF1) tooltip components (type 8). A tooltip draws nothing until the mouse has rested
 * on it for 50 client cycles (one second); then it shows a pale yellow box with its text below
 * its own bounds. Kept free of WebGL so the timer and the box can be tested on their own.
 */

/** Client cycles the mouse must stay on a tooltip component before its box is shown. */
export const IF1_TOOLTIP_DELAY = 50;
export const IF1_TOOLTIP_FILL = 0xffffa0;
export const IF1_TOOLTIP_BORDER = 0x000000;

/**
 * Which tooltip component the mouse is on, and for how long. The timer counts up one per client
 * cycle while the mouse is on any tooltip component and back down while it is on none; it is
 * not restarted when the mouse moves from one tooltip component to the next.
 */
export class If1TooltipState {
    private hoveredUid: number | null = null;
    private hoverCycle = -1;
    private lastCycle = -1;
    timer = 0;

    /**
     * Brings the timer up to `cycle`. Call once per draw pass, before the components are drawn;
     * calling again in the same cycle changes nothing. A hover counts when a draw pass since the
     * previous step reported it.
     */
    advance(cycle: number): void {
        cycle |= 0;
        if (this.lastCycle < 0 || cycle < this.lastCycle) {
            this.lastCycle = cycle;
            return;
        }
        const elapsed = cycle - this.lastCycle;
        if (elapsed === 0) return;
        const hovering = this.hoveredUid !== null && this.hoverCycle >= this.lastCycle;
        if (hovering) {
            this.timer = Math.min(IF1_TOOLTIP_DELAY, this.timer + elapsed);
        } else {
            this.hoveredUid = null;
            this.timer = Math.max(0, this.timer - elapsed);
        }
        this.lastCycle = cycle;
    }

    /** The mouse is on this tooltip component during the draw pass of `cycle`. */
    hover(uid: number, cycle: number): void {
        this.hoveredUid = uid | 0;
        this.hoverCycle = cycle | 0;
    }

    /** The mouse is not on this tooltip component; forgets it if it was the hovered one. */
    leave(uid: number): void {
        if (this.hoveredUid === (uid | 0)) this.hoveredUid = null;
    }

    isShown(uid: number): boolean {
        return this.hoveredUid === (uid | 0) && this.timer === IF1_TOOLTIP_DELAY;
    }

    /** True while a later draw pass can change what is shown (counting, shown or fading out). */
    isActive(): boolean {
        return this.hoveredUid !== null || this.timer > 0;
    }
}

export type If1TooltipLayout = {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Each line with the x of its left edge and the y of its baseline. */
    lines: { text: string; x: number; baseline: number }[];
};

/**
 * The tooltip box for a component at (x, y) of the given size. Lines are split at "<br>"; the
 * box is 6 wider than the widest line and each line takes the font's ascent plus 1. The box sits
 * 5 below the component with its right edge 5 inside the component's, never left of the
 * component's left edge plus 5, and is pushed back inside the right and bottom of the clip.
 */
export function layoutIf1Tooltip(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    clipRight: number,
    clipBottom: number,
    fontAscent: number,
    measure: (line: string) => number,
): If1TooltipLayout {
    const lineTexts: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        const at = remaining.indexOf("<br>");
        if (at !== -1) {
            lineTexts.push(remaining.slice(0, at));
            remaining = remaining.slice(at + 4);
        } else {
            lineTexts.push(remaining);
            remaining = "";
        }
    }

    let boxWidth = 0;
    for (const line of lineTexts) boxWidth = Math.max(boxWidth, measure(line) | 0);
    boxWidth += 6;
    const boxHeight = lineTexts.length * (fontAscent + 1) + 7;

    let boxX = x + width - 5 - boxWidth;
    let boxY = y + height + 5;
    if (boxX < x + 5) boxX = x + 5;
    if (boxX + boxWidth > clipRight) boxX = clipRight - boxWidth;
    if (boxY + boxHeight > clipBottom) boxY = clipBottom - boxHeight;

    const lines = lineTexts.map((line, i) => ({
        text: line,
        x: boxX + 3,
        baseline: boxY + fontAscent + 2 + i * (fontAscent + 1),
    }));
    return { x: boxX, y: boxY, width: boxWidth, height: boxHeight, lines };
}
