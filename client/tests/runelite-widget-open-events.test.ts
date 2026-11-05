import { strict as assert } from "node:assert";
import { ChatMessage, WidgetLoaded } from "@runelite/api/events";
import { bindWidgetEvents, WidgetSourceBinder } from "../runelite/impl/ContainerEventSource";
import { bindDialogueChat } from "../runelite/impl/DialogueChatSource";
import { WidgetManager } from "../widgets/WidgetManager";

// RuneLite posts WidgetLoaded on every interface open. The widget manager keeps a group loaded when
// the same group is re-mounted (an NPC dialogue's second page is an IF_OPENSUB of chat_left with no
// close in between), so the events must come from the open, not only from the group load.

const CHAT_LEFT = 231;
const HOST = (162 << 16) | 567;

const manager = new WidgetManager({} as never, {
    loadWidgetGroup(groupId: number) {
        const node = (fileId: number, parentUid = -1): any => ({
            uid: (groupId << 16) | fileId, groupId, fileId, parentUid,
            type: 0, rawX: 0, rawY: 0, rawWidth: 200, rawHeight: 200,
            hidden: false, isHidden: false, text: "",
        });
        const root = node(0);
        const widgets = new Map<number, any>([[root.uid, root]]);
        if (groupId === 162) {
            const host = node(567, root.uid);
            widgets.set(host.uid, host);
        } else if (groupId === CHAT_LEFT) {
            for (const child of [4, 5, 6]) widgets.set((groupId << 16) | child, node(child, root.uid));
        }
        return { root, widgets };
    },
    unloadGroup() {},
} as never);
manager.setRootInterface(162);

const client: any = { widgetManager: manager };
const loaded: number[] = [];
bindWidgetEvents(client, (e) => {
    if (e instanceof WidgetLoaded) loaded.push(e.getGroupId());
});
const ticks = new Set<() => void>();
const dialog: string[] = [];
bindDialogueChat(client, (e: ChatMessage) => dialog.push(e.getMessage()), (tick) => {
    ticks.add(tick);
    return () => ticks.delete(tick);
});
const tick = () => {
    for (const t of ticks) t();
};
const setText = (child: number, text: string) => {
    manager.getWidgetByUid((CHAT_LEFT << 16) | child)!.text = text;
};

// Page 1: IF_OPENSUB(231), then IF_SETTEXT name and text, then the tick.
manager.openSubInterface(HOST, CHAT_LEFT, 0);
setText(4, "Falo the Bard");
setText(6, "Page one");
tick();
assert.deepEqual(loaded.filter((g) => g === CHAT_LEFT), [CHAT_LEFT], "the first page loads the group");
assert.deepEqual(dialog, ["Falo the Bard|Page one"]);

// Page 2: the server re-opens the same group with no close; the group stays loaded.
manager.openSubInterface(HOST, CHAT_LEFT, 0);
setText(6, "Page two");
tick();
assert.deepEqual(loaded.filter((g) => g === CHAT_LEFT), [CHAT_LEFT, CHAT_LEFT], "the second page is an open too");
assert.deepEqual(dialog, ["Falo the Bard|Page one", "Falo the Bard|Page two"]);

// Page 3 in the same tick as page 2's text change is still one page per open.
manager.openSubInterface(HOST, CHAT_LEFT, 0);
setText(6, "Page three");
tick();
assert.equal(dialog.length, 3);
assert.equal(dialog[2], "Falo the Bard|Page three");

// Closing and reopening loads the group again: exactly one event, not two.
manager.closeSubInterface(HOST, true);
manager.openSubInterface(HOST, CHAT_LEFT, 0);
setText(4, "Falo the Bard");
setText(6, "After close");
tick();
assert.equal(loaded.filter((g) => g === CHAT_LEFT).length, 4, "load and open of one IF_OPENSUB count once");
assert.equal(dialog.length, 4);

// --- Binding before the widget manager exists ---------------------------------------------------------
// RuneLite.load() runs from the OsrsClient constructor; the widget manager is created later in the
// async init, and the client then asks the binder again. Nothing polls in between.
{
    const late: any = {};
    const lateLoaded: number[] = [];
    const binder = new WidgetSourceBinder(late, (e) => {
        if (e instanceof WidgetLoaded) lateLoaded.push(e.getGroupId());
    });
    assert.equal(binder.bind(), false, "no widget manager yet: nothing bound");
    late.widgetManager = manager;
    const before = manager.groupLoadedListeners.size;
    assert.equal(binder.bind(), true, "bound once the manager exists");
    // Two listeners: WidgetLoaded and the dialogue chat source each watch group loads.
    assert.equal(manager.groupLoadedListeners.size, before + 2, "the listeners are on the real manager");
    assert.equal(binder.bind(), true, "binding again is a no-op");
    assert.equal(manager.groupLoadedListeners.size, before + 2, "no duplicate listeners");
    manager.closeSubInterface(HOST, true);
    manager.openSubInterface(HOST, CHAT_LEFT, 0);
    assert.deepEqual(lateLoaded, [CHAT_LEFT], "and sees the next open");
    binder.release();
    assert.equal(manager.groupLoadedListeners.size, before);
    assert.equal(binder.bind(), true, "can bind again after a release");
    binder.release();
}

console.log("runelite-widget-open-events: ok");
