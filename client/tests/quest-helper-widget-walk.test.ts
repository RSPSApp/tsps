import { strict as assert } from "node:assert";
import { collectHelperWidgets } from "../game/plugins/questhelper/QuestHelperSnapshot";
import { SnapshotReuse } from "../game/plugins/questhelper/QuestHelperReuse";
import type { HelperWidget } from "../game/plugins/questhelper/QuestHelperProtocol";
import { WidgetManager } from "../widgets/WidgetManager";

// Quest Helper reuses its last widget walk while nothing it read has changed: the shape through
// WidgetManager.structureVersion, every field by comparison. Each write below goes straight to
// the node, with no invalidation, as scripts, packets and plugins can.

const ROOT = 162;
const MODAL = 231;
const HOST = (ROOT << 16) | 5;

const manager = new WidgetManager({} as never, {
    loadWidgetGroup(groupId: number) {
        const node = (fileId: number, parentUid = -1): any => ({
            uid: (groupId << 16) | fileId, id: (groupId << 16) | fileId, groupId, fileId, parentUid, childIndex: -1,
            type: 0, rawX: 0, rawY: 0, rawWidth: 200, rawHeight: 200, x: 0, y: 0, width: 200, height: 200,
            hidden: false, isHidden: false, text: "",
        });
        const root = node(0);
        const widgets = new Map<number, any>([[root.uid, root]]);
        for (const child of [4, 5, 6]) widgets.set((groupId << 16) | child, node(child, root.uid));
        return { root, widgets };
    },
    unloadGroup() {},
} as never);
manager.setRootInterface(ROOT);

const find = (widgets: (HelperWidget | null)[] | undefined, uid: number): HelperWidget | undefined => {
    for (const w of widgets ?? []) {
        if (!w) continue;
        if (w.runtimeId === uid) return w;
        const hit = find(w.staticChildren, uid) ?? find(w.dynamicChildren, uid) ?? find(w.nestedChildren, uid);
        if (hit) return hit;
    }
    return undefined;
};
const widget = (uid: number) => manager.getWidgetByUid(uid)!;

let last = collectHelperWidgets(manager);
assert.ok(find(last, (ROOT << 16) | 4), "the root's static children are walked");
assert.equal(collectHelperWidgets(manager), last, "an unchanged tree hands back the same walk");

const changed = (why: string) => {
    const next = collectHelperWidgets(manager);
    assert.notEqual(next, last, why);
    assert.equal(collectHelperWidgets(manager), next, `${why}: and is reused again after`);
    last = next;
    return next;
};

// Field writes with no invalidation.
widget((ROOT << 16) | 4).text = "Talk-to";
assert.equal(find(changed("a text write"), (ROOT << 16) | 4)?.text, "Talk-to");
widget((ROOT << 16) | 4).itemId = 1944;
assert.equal(find(changed("an item write"), (ROOT << 16) | 4)?.itemId, 1944);
widget((ROOT << 16) | 6)._absX = 37;
assert.equal(find(changed("a layout write"), (ROOT << 16) | 6)?.bounds?.x, 37);
widget((ROOT << 16) | 6).opBase = "Pick";
assert.equal(find(changed("an op base write"), (ROOT << 16) | 6)?.name, "Pick");

// A parent's hidden flag hides everything under it.
widget((ROOT << 16) | 0).hidden = true;
assert.equal(find(changed("hiding the root"), (ROOT << 16) | 6)?.hidden, true);
widget((ROOT << 16) | 0).hidden = false;
assert.equal(find(changed("showing it again"), (ROOT << 16) | 6)?.hidden, false);

// Shape: an interface opens in a container and closes again.
manager.openSubInterface(HOST, MODAL, 0);
assert.ok(find(changed("an opened interface"), (MODAL << 16) | 4), "its widgets are walked");
widget((MODAL << 16) | 4).text = "Second page";
assert.equal(find(changed("a write in the opened interface"), (MODAL << 16) | 4)?.text, "Second page");
manager.closeSubInterface(HOST);
assert.equal(find(changed("a closed interface"), (MODAL << 16) | 4), undefined, "its widgets are gone");

// Dynamic children: a CC_CREATE-style slot, then a slot swapped in place.
const parent = widget((ROOT << 16) | 4);
const child: any = { uid: 0x7fff0001, id: parent.uid, groupId: ROOT, fileId: -1, parentUid: parent.uid, childIndex: 0,
    type: 4, x: 0, y: 0, width: 10, height: 10, hidden: false, isHidden: false, text: "One" };
parent.children = [child];
manager.registerWidget(child);
assert.equal(find(changed("a created child"), child.uid)?.text, "One");
const swapped: any = { ...child, uid: 0x7fff0002, text: "Two" };
parent.children[0] = swapped;
assert.equal(find(changed("a slot swapped without registering"), swapped.uid)?.text, "Two");
swapped.childIndex = -1;
swapped.fileId = 3;
assert.equal(find(changed("a slot no longer a runtime child"), swapped.uid), undefined);

// The digest of a reused walk is not recomputed.
const reuse = new SnapshotReuse();
const snapshot: any = { widgets: last };
const first = reuse.prepare("s", snapshot).digests?.widgets;
reuse.accept("s", { widgets: first });
assert.equal(reuse.prepare("s", { widgets: collectHelperWidgets(manager) } as any).reuse?.widgets, first, "the same walk is named by the held digest");

console.log("quest helper widget walk reuse passed");
