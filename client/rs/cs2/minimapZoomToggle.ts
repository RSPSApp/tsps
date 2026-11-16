import { Opcodes } from "./Opcodes";
import type { Script } from "./Script";

/**
 * "Enable Minimap zoom" (All Settings row 166) is ticked while `minimap_zoom_lock_disabled`
 * (varbit 12983) is 0: its row is drawn inverted, and the toplevel layout (script 876), the
 * pinch handler (7025) and "Restore Minimap zoom" (7028) all let the minimap zoom only at 0.
 * The row's click script flips the varbit, then makes the minimap zoomable from the new value:
 *
 *     iconst 1; get_varbit 12983; sub; set_varbit 12983
 *     get_varbit 12983; gosub 633; minimap_setzoomable
 *
 * so ticking the box locked the zoom and unticking it allowed it, until the next layout load
 * put it right again. The fix reads the value before the flip instead (the same length, so no
 * jump moves):
 *
 *     get_varbit 12983; iconst 1; get_varbit 12983; sub; set_varbit 12983
 *     gosub 633; minimap_setzoomable
 */
export const MINIMAP_ZOOM_TOGGLE_SCRIPT = 5190;
const MINIMAP_ZOOM_LOCK_DISABLED = 12983;

type Op = [number, number];

const FLIP_THEN_READ: Op[] = [
    [Opcodes.ICONST, 1],
    [Opcodes.GET_VARBIT, MINIMAP_ZOOM_LOCK_DISABLED],
    [Opcodes.SUB, 0],
    [Opcodes.SET_VARBIT, MINIMAP_ZOOM_LOCK_DISABLED],
    [Opcodes.GET_VARBIT, MINIMAP_ZOOM_LOCK_DISABLED],
];
const READ_THEN_FLIP: Op[] = [
    [Opcodes.GET_VARBIT, MINIMAP_ZOOM_LOCK_DISABLED],
    [Opcodes.ICONST, 1],
    [Opcodes.GET_VARBIT, MINIMAP_ZOOM_LOCK_DISABLED],
    [Opcodes.SUB, 0],
    [Opcodes.SET_VARBIT, MINIMAP_ZOOM_LOCK_DISABLED],
];

function indexOfOps(script: Script, ops: readonly Op[]): number {
    for (let start = 0; start + ops.length <= script.instructions.length; start++) {
        if (ops.every(([opcode, operand], i) =>
            script.instructions[start + i] === opcode && script.intOperands[start + i] === operand)) {
            return start;
        }
    }
    return -1;
}

/** Makes the toggle set the zoom from the ticked state; false (unchanged) if it isn't the one expected. */
export function fixMinimapZoomToggle(script: Script): boolean {
    const start = indexOfOps(script, FLIP_THEN_READ);
    if (start < 0) return false;
    READ_THEN_FLIP.forEach(([opcode, operand], i) => {
        script.instructions[start + i] = opcode;
        script.intOperands[start + i] = operand;
    });
    return true;
}

export function applyMinimapZoomToggleFix(script: Script): void {
    if (script.id !== MINIMAP_ZOOM_TOGGLE_SCRIPT) return;
    if (!fixMinimapZoomToggle(script)) {
        console.warn(`[cs2] script ${script.id}: no minimap zoom toggle to fix`);
    }
}
