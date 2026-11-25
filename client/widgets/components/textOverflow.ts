/** A readable pause at each end, followed by a leftward scroll and a reset. */
export function overflowOffset(textWidth: number, width: number, elapsedMs: number): number {
    const distance = Math.max(0, textWidth - width);
    if (!distance) return 0;
    const pause = 1200, travel = distance / 24 * 1000;
    const phase = Math.max(0, elapsedMs) % (pause * 2 + travel);
    return Math.min(distance, Math.max(0, phase - pause) * 24 / 1000);
}

const epochs = new WeakMap<object, { text: string; width: number; time: number }>();
export function scrollingTextOffset(widget: object, text: string, textWidth: number, width: number, now: number): number {
    let state = epochs.get(widget);
    if (!state || state.text !== text || state.width !== width) {
        state = { text, width, time: now };
        epochs.set(widget, state);
    }
    return overflowOffset(textWidth, width, now - state.time);
}
