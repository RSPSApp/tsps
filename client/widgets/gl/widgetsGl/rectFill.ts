/**
 * How opaque a rectangle component is drawn (0-255 at its top and bottom edge), by fill mode:
 *  - plain gradient (mode 1): always solid, whatever the component's transparency;
 *  - alpha gradient (mode 2): the top takes the transparency, the bottom its own bottom
 *    transparency (0 unless a script set it), each independently;
 *  - solid fill or outline: one alpha from the transparency; nothing at 255.
 */
export function rectangleAlphas(
    filled: boolean,
    fillMode: number,
    transparency: number,
    transparencyBottom: number | undefined,
): { draw: boolean; top: number; bottom: number } {
    if (filled && fillMode === 1) return { draw: true, top: 255, bottom: 255 };
    if (filled && fillMode === 2) {
        return { draw: true, top: 255 - (transparency & 255), bottom: 255 - ((transparencyBottom ?? 0) & 255) };
    }
    const alpha = 255 - transparency;
    return { draw: transparency < 255, top: alpha, bottom: alpha };
}
