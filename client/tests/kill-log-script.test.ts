import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeRunClientScript } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// The Boss Kill Log (kill_log, 549) as the server draws it: rev 242's killcounts (script 9525)
// with its names (stringarray), kills and streaks (intarrays), the title and 1 for the Reset
// Streak ops. The script copies the names whole with array_copy's length -1, which the VM must
// read as "the rest of the array". Script 9527 writes kill counts with commas; 9528 writes a
// negative streak as "---" (the Awakened rows).
const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm(), wm = vm.context.widgetManager;
wm.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent({ args: widget.onLoad, widget });
wm.resize(765, 503);
wm.setRootInterface(161);
wm.openSubInterface((161 << 16) | 16, 549, 0);

const message = decodeServerPacket(new Uint8Array(encodeRunClientScript(9525, [
    ["Abyssal Sire", "Vardorvis (Awakened)", "Zulrah"], [5, 3, 1974], [5, -1, 100], "Boss Kill Log", 1,
]))) as any;
const ints: number[] = [], objects: any[] = [];
for (const arg of message.payload.args) (typeof arg === "number" ? ints : objects).push(arg);
vm.run(vm.context.loadScript(9525), ints, objects);
assert.equal(vm.lastError, null);

const texts = (child: number) => (wm.getWidgetByUid((549 << 16) | child)?.children ?? []).filter(Boolean).map((c: any) => c.text);
assert.equal(wm.getWidgetByUid((549 << 16) | 3).text, "Boss Kill Log");
assert.deepEqual(texts(13), ["Abyssal Sire", "Vardorvis (Awakened)", "Zulrah"]);
assert.deepEqual(texts(14), ["5", "3", "1,974"]);
assert.deepEqual(texts(15), ["5", "<col=9f9f9f>---</col>", "100"]);
const resets = (wm.getWidgetByUid((549 << 16) | 16)?.children ?? []).filter(Boolean);
assert.equal(resets.length, 3, "a Reset Streak button per row");
assert.ok(resets.every((button: any) => (button.actions ?? button.ops ?? []).includes("Reset Streak")), "each offers Reset Streak");

console.log("kill log script: ok");
