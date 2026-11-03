import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { IndexType } from "../rs/cache/IndexType";
import { Opcodes } from "../rs/cs2/Opcodes";
import { assembleRs2asm } from "../rs/cs2/rs2asm";
import { RUNELITE_CHAT_SCRIPTS } from "../rs/cs2/runelite/chatScripts";
import { loadRuneliteScript } from "../rs/cs2/runeliteScripts";
import { parseScriptFromBytes, Script } from "../rs/cs2/Script";
import { dispatchMenuAction, menuClickListeners, type MenuActionData } from "../ui/menu/menuEvents";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

// --- rs2asm: switch tables and numbered ops ------------------------------------------------------
const tiny = assembleRs2asm(`.id                       9001
.int_arg_count            1
.long_arg_count           0
.obj_arg_count            0
   iload                  0
   switch
      2: TWO
      -1: OTHER
   5025
   return
TWO:
   iconst                 2
   return
OTHER:
   iconst                 -1
   return`);
assert.deepEqual([...tiny.instructions], [Opcodes.ILOAD, Opcodes.SWITCH, Opcodes.CHAT_GETTIMESTAMPS, Opcodes.RETURN,
    Opcodes.ICONST, Opcodes.RETURN, Opcodes.ICONST, Opcodes.RETURN]);
assert.equal(tiny.intOperands[1], 0, "the switch's operand is its table");
assert.equal(tiny.switches?.length, 1);
assert.equal(tiny.switches![0].get(2), 4 - 1 - 1, "a case's offset is target - pc - 1, as a jump's");
assert.equal(tiny.switches![0].get(-1), 6 - 1 - 1);
assert.throws(() => assembleRs2asm(".id 1\n   iconst 1\n   2: NOWHERE"), /case outside a switch/);

// --- MenuOptionClicked: a listener can consume a click before it is dispatched -------------------
const action: MenuActionData = { param0: 0, param1: 0, opcode: 57, identifier: 1, itemId: -1, option: "Search", target: "",
    screenX: 0, screenY: 0 };
const dispatched: number[] = [];
const consume = (a: MenuActionData) => a.option === "Search";
menuClickListeners.add(consume);
dispatchMenuAction(action, (a) => dispatched.push(a.opcode));
assert.deepEqual(dispatched, [], "consumed");
dispatchMenuAction({ ...action, option: "Other" }, (a) => dispatched.push(a.opcode));
assert.deepEqual(dispatched, [57], "not consumed: dispatched");
menuClickListeners.delete(consume);
dispatchMenuAction(action, (a) => dispatched.push(a.opcode));
assert.deepEqual(dispatched, [57, 57]);

// --- RuneLite's chat scripts replace the cache's (same SHA-256 as RuneLite's .hash files) -------
assert.deepEqual(RUNELITE_CHAT_SCRIPTS.map((s) => [s.id, s.name]), [[84, "ChatBuilder"], [89, "ChatSplitBuilder"], [4742, "ChatTimestamp"]]);

// CI has no server cache, so it stops after the checks above.
if (!existsSync(resolve(__dirname, "../../server/caches/caches.json"))) {
    console.log("RuneLite chat scripts: ok (no server cache, cache script checks skipped)");
    process.exit(0);
}

const { scripts, cache } = createCacheVm();
const index: any = cache.getIndex(IndexType.DAT2.clientScript);
const callbacks: Record<number, string[]> = {
    84: ["chatFilterCheck", "chatMessageBuilding", "privChatUsername"],
    89: ["chatFilterCheck", "chatMessageBuilding", "splitPrivChatUsernameColor"],
    4742: [],
};
for (const patch of RUNELITE_CHAT_SCRIPTS) {
    const script = scripts.load(patch.id)!;
    const vanilla = parseScriptFromBytes(patch.id, index.getArchive(patch.id).getFile(0).data, cache.decodeProfile);
    for (const name of callbacks[patch.id]) assert.ok(script.stringOperands.includes(name), `${patch.name} calls ${name}`);
    assert.notEqual(script.instructions.length, vanilla.instructions.length, `script ${patch.id} is RuneLite's ${patch.name}`);
    // The builders switch on the message type: the same cases as the cache's script.
    assert.deepEqual((script.switches ?? []).map((t) => [...t.keys()].sort((a, b) => a - b)),
        (vanilla.switches ?? []).map((t) => [...t.keys()].sort((a, b) => a - b)), `${patch.name}'s switch cases`);
}

// A patch for other bytes, or one that doesn't assemble, keeps the cache's script.
const warn = console.warn;
console.warn = () => {};
assert.equal(loadRuneliteScript(84, new Int8Array([1, 2, 3]), new Script()), null, "other bytes: the cache's");
const patch = RUNELITE_CHAT_SCRIPTS[2] as { source: string };
const source = patch.source;
patch.source = ".id 4742\n   not_an_op";
const raw = index.getArchive(4742).getFile(0).data;
assert.equal(loadRuneliteScript(4742, raw, new Script()), null, "a patch that can't assemble: the cache's");
patch.source = source;
console.warn = warn;

console.log("RuneLite chat scripts tests passed");
