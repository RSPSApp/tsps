import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWidgetActionPayload } from "../game/widgets/widgetActionPayload";
import { setMenuEventHooks } from "../ui/menu/menuEvents";

async function main() {
    (globalThis as any).self = globalThis;
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");
    const parent = { uid: (12 << 16) | 13, groupId: 12, fileId: 13 };
    const child = { uid: (12 << 16) | 0x8000, parentUid: parent.uid, groupId: 12,
        fileId: -1, childIndex: 4, itemId: 4151, actions: ["Withdraw-1"] };
    let native: any;
    const manager: any = { getWidgetByUid: () => parent, getWidgetFlags: () => 0 };
    const client: any = { widgetManager: manager, handleNativeWidgetAction: (event: any) => { native = event; } };
    const click = (event: any) => { native = undefined; OsrsClient.prototype.handleWidgetAction.call(client, event); };
    for (const option of [undefined, "Script-only button"]) {
        click({ widget: child, option });
        assert.equal(native.widget, child, "native plugins see the original CC_CREATE child");
        assert.equal(native.opIndex, undefined, "the router retains its op-1 fallback");
        assert.equal(buildWidgetActionPayload(manager, native)?.opId, undefined);
    }
    click({ widget: child, option: "Withdraw-1" });
    assert.equal(native.opIndex, 1);
    assert.equal(native.slot, 4);
    assert.equal(native.itemId, 4151);
    const payload = buildWidgetActionPayload(manager, native)!;
    assert.equal(payload.widgetId, parent.uid);
    assert.equal(payload.slot, 4);
    click({ widget: { ...child, targetVerb: "Use" }, option: "Use" });
    assert.equal(native.opIndex, 0, "an explicit target verb keeps op zero");
    click({ widget: child, opIndex: 7 });
    assert.equal(native.opIndex, 7);
    const dispose = setMenuEventHooks({ build: entries => entries, opened: entries => entries,
        shouldOpen: open => open, click: () => true });
    try { click({ widget: child }); assert.equal(native, undefined, "consumed clicks stop native dispatch"); }
    finally { dispose(); }
    console.log("Widget dispatch preserves implicit ops, dynamic children, target verbs and cancellation");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
