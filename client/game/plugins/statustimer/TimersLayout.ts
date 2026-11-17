/** Geometry in CSS pixels; includes the existing 26px box's two 1px borders. */
const BOX = 28;
const STRIDE = 30;

export function timersScale(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(200, Math.max(75, numeric)) / 100 : 1;
}

/** Pack the whole group before positioning any slot, so clamping never overlaps boxes. */
export function packTimers(
    count: number,
    bounds: { left: number; top: number; right: number; bottom: number },
    scale: number,
    fromRight = false,
    fromBottom = false,
): { slots: Array<{ left: number; top: number }>; scale: number; height: number } {
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    count = Math.max(0, Math.floor(count));
    let columns = 1;
    let rows = 0;
    // A tiny/short viewport may need to fit below the requested size. Never drop a timer.
    for (let attempt = 0; attempt < 3; attempt++) {
        scale = Math.min(scale, width / BOX);
        columns = Math.max(1, Math.min(count, Math.floor((width / scale + STRIDE - BOX) / STRIDE)));
        rows = Math.ceil(count / columns);
        const groupHeight = Math.max(0, rows * STRIDE - (STRIDE - BOX));
        if (groupHeight * scale <= height) break;
        scale = Math.min(scale, height / groupHeight);
    }
    const groupHeight = Math.max(0, rows * STRIDE - (STRIDE - BOX)) * scale;
    return {
        scale,
        height: groupHeight,
        slots: Array.from({ length: count }, (_, slot) => {
            const x = (slot % columns) * STRIDE * scale;
            const y = Math.floor(slot / columns) * STRIDE * scale;
            return {
                left: fromRight ? bounds.right - BOX * scale - x : bounds.left + x,
                top: fromBottom ? bounds.bottom - groupHeight + y : bounds.top + y,
            };
        }),
    };
}
