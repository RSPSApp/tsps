import assert from "node:assert/strict";

import { getWorldClickBlockingWidgetAtPoint } from "../game/widgets/interaction/widgetClickProbe";
import { isCloseOnOutsideClickModalTarget } from "../game/widgets/gameframePanes";
import { WidgetManager } from "../widgets/WidgetManager";

// OSRS mounts the bank (and other main modals) into the gameframe's mainmodal
// pane, which in the standard layout is the whole 512x334 viewport. The pane is
// larger than the mounted interface. A click on the world outside the interface
// content must not be swallowed by the pane: the client closes the modal and the
// click still walks/interacts. A click on the interface itself still blocks, and
// a chatbox modal (dialogue) keeps blocking without the close-on-outside rule.

const ROOT = 161;
const MAIN_MODAL = (ROOT << 16) | 16;
const CHAT_MODAL = (162 << 16) | 566;
const BANK = 12;

function widget(uid: number, x: number, y: number, width: number, height: number, extra = {}): any {
    return {
        uid,
        groupId: (uid >>> 16) & 0xffff,
        fileId: uid & 0xffff,
        type: 0,
        x,
        y,
        width,
        height,
        hidden: false,
        isHidden: false,
        ...extra,
    };
}

function managerFor(hostUid: number, group: number, closeOnOutsideClick: boolean): any {
    const root = widget(ROOT << 16, 0, 0, 765, 503);
    const host = widget(hostUid, 0, 0, 512, 334);
    const mounted = widget(group << 16, 0, 0, 488, 330);
    const frame = widget((group << 16) | 1, 0, 0, 488, 330);
    const groups = new Map<number, any[]>([
        [ROOT, [root]],
        [group, [mounted, frame]],
    ]);
    return {
        rootInterface: ROOT,
        interfaceParents: new Map<number, any>([
            [hostUid, { group, type: 0, closeOnOutsideClick }],
        ]),
        getInputRoots: () => [root, mounted],
        getAllGroupRoots: (id: number) => groups.get(id) ?? [],
        getStaticChildrenByParentUid: (uid: number) => {
            if (uid === root.uid) return [host];
            if (uid === mounted.uid) return [frame];
            return [];
        },
        getWidgetByUid: (uid: number) => {
            for (const list of groups.values()) {
                const found = list.find((candidate) => candidate.uid === uid);
                if (found) return found;
            }
            return uid === host.uid ? host : undefined;
        },
        getWidgetFlags: (w: any) => w?.flags ?? 0,
    };
}

// The whole viewport is the bank pane, but the bank content is 488x330. A click
// beyond that content is a world click, so no widget blocks it.
const mainModal = managerFor(MAIN_MODAL, BANK, true);
assert.equal(
    getWorldClickBlockingWidgetAtPoint(mainModal, null, 500, 332),
    null,
    "a world click outside the main modal content is not blocked by its pane",
);
assert.ok(
    getWorldClickBlockingWidgetAtPoint(mainModal, null, 100, 100),
    "a click on the main modal content is still captured",
);

// A chatbox modal keeps blocking, even where its pane has no child: dialogues
// are not closed by clicking the world.
const chatModal = managerFor(CHAT_MODAL, 217, false);
assert.ok(
    getWorldClickBlockingWidgetAtPoint(chatModal, null, 100, 332),
    "a chatbox modal keeps blocking input",
);

// A pane with the close-on-outside flag but content under the click is still the
// interface's own surface, not the world behind it.
assert.ok(
    getWorldClickBlockingWidgetAtPoint(mainModal, null, 487, 329),
    "the last pixel of the mounted interface still captures the click",
);

// Only the gameframe's main and side modal panes close on an outside click. The
// chatbox (dialogue) and display modal panes do not, and neither does an overlay
// mounted in the mainmodal pane.
assert.equal(isCloseOnOutsideClickModalTarget((ROOT << 16) | 16, 0), true, "main modal");
assert.equal(isCloseOnOutsideClickModalTarget((ROOT << 16) | 74, 3), true, "side modal");
assert.equal(isCloseOnOutsideClickModalTarget(CHAT_MODAL, 0), false, "chatbox modal");
assert.equal(isCloseOnOutsideClickModalTarget((165 << 16) | 39, 0), false, "display modal");
assert.equal(isCloseOnOutsideClickModalTarget((ROOT << 16) | 16, 1), false, "overlay");

// The mount records the pane's close-on-outside rule so the client can send
// IF_CLOSE from the world click path.
const real = new WidgetManager({} as never, {
    loadWidgetGroup(groupId: number) {
        const root = { ...widget(groupId << 16, 0, 0, 512, 334), parentUid: -1, rawWidth: 512, rawHeight: 334 };
        const widgets = [root];
        if (groupId === ROOT) {
            for (const childId of [16, 74]) {
                widgets.push({
                    ...widget((ROOT << 16) | childId, 0, 0, 512, 334),
                    parentUid: root.uid,
                    rawWidth: 512,
                    rawHeight: 334,
                });
            }
        } else {
            widgets.push({
                ...widget((groupId << 16) | 1, 0, 0, 488, 330),
                parentUid: root.uid,
                rawWidth: 488,
                rawHeight: 330,
            });
        }
        return { root, widgets: new Map(widgets.map((node) => [node.uid, node])) };
    },
    unloadGroup() {},
    getAvailableGroups: () => [ROOT, BANK],
    clearCache() {},
} as never);
real.setRootInterface(ROOT);
real.openSubInterface(MAIN_MODAL, BANK, 0, true);
assert.equal(real.interfaceParents.get(MAIN_MODAL)?.closeOnOutsideClick, true);
real.openSubInterface((ROOT << 16) | 74, BANK, 3, true);
assert.equal(real.interfaceParents.get((ROOT << 16) | 74)?.closeOnOutsideClick, true);

console.log("modal outside click tests passed");
