/**
 * Small drawing rules of the OSRS interface renderer, kept free of WebGL so they can be tested
 * on their own. All coordinates are logical (unscaled) interface pixels unless stated.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * The rows a sprite mask covers, as rectangles relative to the mask's top left corner. A mask
 * holds one span (start and width) per row; equal neighbouring rows are merged. A hidden compass
 * fills these rows with black.
 */
export function spriteMaskRows(xStarts: ArrayLike<number>, xWidths: ArrayLike<number>): Rect[] {
    const rows: Rect[] = [];
    const count = Math.min(xStarts.length, xWidths.length);
    for (let row = 0; row < count; row++) {
        const start = xStarts[row] | 0;
        const width = xWidths[row] | 0;
        if (width <= 0) continue;
        const last = rows[rows.length - 1];
        if (last && last.x === start && last.w === width && last.y + last.h === row) last.h++;
        else rows.push({ x: start, y: row, w: width, h: 1 });
    }
    return rows;
}

/**
 * Legacy (IF1) text: "%1" to "%5" are replaced by the component's first five client script
 * values. A value of 999999999 or more is shown as "*".
 */
export function formatIf1Text(text: string, valueAt: (index: number) => number): string {
    if (text.indexOf("%") === -1) return text;
    for (let i = 1; i <= 5; i++) {
        const placeholder = "%" + i;
        let at = text.indexOf(placeholder);
        if (at === -1) continue;
        const value = valueAt(i - 1) | 0;
        const replacement = value < 999999999 ? String(value) : "*";
        // The replacement is digits or "*", so searching on from the start always ends.
        while (at !== -1) {
            text = text.slice(0, at) + replacement + text.slice(at + 2);
            at = text.indexOf(placeholder);
        }
    }
    return text;
}

/** An item quantity as text components show it: grouped digits, with K and M forms. */
export function formatItemQuantity(quantity: number): string {
    let digits = String(quantity | 0);
    for (let comma = digits.length - 3; comma > 0; comma -= 3) {
        digits = digits.slice(0, comma) + "," + digits.slice(comma);
    }
    if (digits.length > 9) {
        return ` <col=00ff80>${digits.slice(0, digits.length - 8)}M  (${digits})</col>`;
    }
    if (digits.length > 6) {
        return ` <col=ffffff>${digits.slice(0, digits.length - 4)}K  (${digits})</col>`;
    }
    return ` <col=ffff00>${digits}</col>`;
}

/**
 * The text of a modern (IF3) text component that holds an item: the item's name, and when the
 * item always stacks or the quantity is not 1, the name in orange followed by " x" and the
 * quantity. A quantity of -1 shows the bare name.
 */
export function itemWidgetText(name: string | null | undefined, alwaysStacks: boolean, quantity: number): string {
    const text = name ?? "null";
    if ((alwaysStacks || quantity !== 1) && quantity !== -1) {
        return `<col=ff9040>${text}</col> x${formatItemQuantity(quantity)}`;
    }
    return text;
}

/**
 * Whether a hidden component is skipped altogether. A modern component is; a legacy layer
 * (type 0 or 11) is too, unless it is the layer the mouse is over (through a mouse-over
 * redirect), which is how legacy interfaces reveal hover layers.
 */
export function hiddenWidgetSkipped(isIf3: boolean, type: number, isMousedOverIf1: boolean): boolean {
    if (isIf3) return true;
    if (type === 0 || type === 11) return !isMousedOverIf1;
    return true;
}

/**
 * The two ends of a line component. Its width and height are signed offsets from its position,
 * so zero gives a straight line and a negative value runs backwards. With the direction flag
 * the line runs from the bottom left to the top right instead.
 */
export function lineWidgetEndpoints(
    x: number,
    y: number,
    width: number,
    height: number,
    direction: boolean,
): { x1: number; y1: number; x2: number; y2: number } {
    return direction
        ? { x1: x, y1: y + height, x2: x + width, y2: y }
        : { x1: x, y1: y, x2: x + width, y2: y + height };
}

/**
 * Where a rotated sprite is drawn before the rotation is applied: scaled by the same factor on
 * both axes (component width over sprite width, in 4096ths) and centred on the component. The
 * component's height does not stretch it.
 */
export function rotatedSpriteRect(
    x: number,
    y: number,
    width: number,
    height: number,
    spriteWidth: number,
    spriteHeight: number,
): Rect {
    const scale = Math.trunc((width * 4096) / Math.max(1, spriteWidth)) / 4096;
    const w = spriteWidth * scale;
    const h = spriteHeight * scale;
    const centreX = x + Math.trunc(width / 2);
    const centreY = y + Math.trunc(height / 2);
    return { x: centreX - w / 2, y: centreY - h / 2, w, h };
}

/**
 * The transparency (0 solid, 255 invisible) a component is drawn with: the component being held
 * for a drag is forced to 128, unless it renders in place while dragged (a scrollbar handle).
 */
export function heldWidgetTransparency(transparency: number, held: boolean, rendersInPlace: boolean): number {
    return held && !rendersInPlace ? 128 : transparency;
}

/**
 * The handle of a legacy scrollbar: its height and its offset below the top arrow. The handle is
 * the visible share of the track, at least `minHeight`, and is drawn whatever its size, also
 * when it is as tall as the track or taller.
 */
export function scrollbarThumb(
    height: number,
    scrollY: number,
    scrollHeight: number,
    arrowHeight: number,
    minHeight: number,
): { height: number; offset: number } {
    const track = height - arrowHeight * 2;
    let thumb = scrollHeight !== 0 ? Math.trunc((height * track) / scrollHeight) : 0;
    if (thumb < minHeight) thumb = minHeight;
    const range = scrollHeight - height;
    const offset = range > 0 ? Math.trunc((scrollY * (track - thumb)) / range) : 0;
    return { height: thumb, offset };
}
