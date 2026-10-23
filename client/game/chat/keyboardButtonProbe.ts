import { Opcodes } from "../../rs/cs2/Opcodes";
import type { Script } from "../../rs/cs2/Script";

const KEYBOARD_SHOW_OPCODES: ReadonlySet<number> = new Set([
    Opcodes.MOBILE_KEYBOARDSHOW,
    Opcodes.MOBILE_KEYBOARDSHOW2,
]);
/** Listeners a tap runs: op on release, click/hold on press. */
const TAP_LISTENERS = ["onOp", "onClick", "onHold", "onRelease"] as const;
/** Gosub levels followed below the listener script itself. */
const MAX_GOSUB_DEPTH = 3;

/**
 * Finds widgets whose tap opens the soft keyboard (CS2 mobile_keyboardshow). The script runs
 * in the frame loop, after the touch has ended, and iOS only shows the keyboard for a focus
 * made inside the touch event; so the touch handler asks this whether the tapped widget will
 * show it, and focuses the input there. The script's own call then only sets the hint.
 */
export class KeyboardButtonProbe {
    private readonly byScript = new Map<number, boolean>();

    constructor(private readonly loadScript: (id: number) => Script | null) {}

    widgetShowsKeyboard(widget: any): boolean {
        for (const listener of TAP_LISTENERS) {
            const scriptId = widget?.[listener]?.[0];
            if (typeof scriptId === "number" && this.scriptShowsKeyboard(scriptId)) return true;
        }
        return false;
    }

    scriptShowsKeyboard(scriptId: number): boolean {
        let result = this.byScript.get(scriptId);
        if (result === undefined) {
            result = this.scan(scriptId, 0, new Set());
            this.byScript.set(scriptId, result);
        }
        return result;
    }

    private scan(scriptId: number, depth: number, seen: Set<number>): boolean {
        if (seen.has(scriptId)) return false;
        seen.add(scriptId);
        let script: Script | null = null;
        try {
            script = this.loadScript(scriptId);
        } catch {}
        if (!script) return false;
        const { instructions, intOperands } = script;
        for (let i = 0; i < instructions.length; i++) {
            const opcode = instructions[i];
            if (KEYBOARD_SHOW_OPCODES.has(opcode)) return true;
            if (
                opcode === Opcodes.INVOKE &&
                depth < MAX_GOSUB_DEPTH &&
                this.scan(intOperands[i], depth + 1, seen)
            ) {
                return true;
            }
        }
        return false;
    }
}
