import { sha256Hex } from "../../common/utils/sha256";
import { assembleRs2asm } from "./rs2asm";
import { RUNELITE_BANK_SCRIPTS, type RuneliteScript } from "./runelite/bankScripts";
import { RUNELITE_CHAT_SCRIPTS } from "./runelite/chatScripts";
import type { Script } from "./Script";

const SCRIPTS = new Map<number, RuneliteScript>(
    [...RUNELITE_BANK_SCRIPTS, ...RUNELITE_CHAT_SCRIPTS].map((s) => [s.id, s]),
);
const warned = new Set<number>();

/**
 * RuneLite's patched version of cache script `id`, when RuneLite patches it and the cache's
 * bytes are the ones RuneLite's patch was made from (RuneLite checks the same hash). Otherwise
 * null, and the cache's own script is used.
 */
export function loadRuneliteScript(id: number, data: Int8Array, vanilla: Script): Script | null {
    const patch = SCRIPTS.get(id);
    if (!patch) return null;
    if (sha256Hex(data) !== patch.hash) {
        if (!warned.has(id)) {
            warned.add(id);
            console.warn(`[cs2] script ${id} isn't the one RuneLite's ${patch.name} patches; using the cache's`);
        }
        return null;
    }
    let script: Script;
    try {
        script = assembleRs2asm(patch.source);
    } catch (error) {
        // A patch this client can't assemble must not take the script away.
        if (!warned.has(id)) {
            warned.add(id);
            console.warn(`[cs2] couldn't assemble RuneLite's ${patch.name}; using the cache's script ${id}`, error);
        }
        return null;
    }
    script.name = vanilla.name;
    script.localIntCount = Math.max(script.localIntCount, vanilla.localIntCount);
    script.localObjCount = Math.max(script.localObjCount, vanilla.localObjCount);
    script.localLongCount = Math.max(script.localLongCount, vanilla.localLongCount);
    return script;
}
