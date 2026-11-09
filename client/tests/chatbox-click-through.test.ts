import { strict as assert } from "node:assert";
import {
    CHAT_BACKGROUND_UID,
    CHAT_MESSAGES_UID,
    asWorldMenuEntries,
    isChatMessageAreaWidget,
    isChatboxClickThroughActive,
} from "../game/widgets/interaction/chatboxClickThrough";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { findBlockingWidgetInHits } from "../widgets/menu/utils";

const uid = (group: number, child: number) => (group << 16) | child;

// Click-through follows the transparency varbit and the flag the chatbox script sets.
{
    const background = { uid: CHAT_BACKGROUND_UID, noClickThrough: false };
    const byUid = (id: number) => (id === CHAT_BACKGROUND_UID ? background : undefined);
    const varbits = (transparent: number) => (id: number) => (id === 4608 ? transparent : 0);
    assert.equal(isChatboxClickThroughActive(varbits(1), byUid), true, "transparent and let through");
    assert.equal(isChatboxClickThroughActive(varbits(0), byUid), false, "an opaque chatbox blocks");
    background.noClickThrough = true;
    assert.equal(isChatboxClickThroughActive(varbits(1), byUid), false, "the script blocks it (setting off, fixed mode)");
    assert.equal(isChatboxClickThroughActive(varbits(1), () => undefined), false, "no chatbox");
}

// The message area is the background, the message list and its lines; nothing else of the chatbox.
{
    assert.equal(isChatMessageAreaWidget({ uid: CHAT_BACKGROUND_UID }), true);
    assert.equal(isChatMessageAreaWidget({ uid: CHAT_MESSAGES_UID }), true);
    assert.equal(isChatMessageAreaWidget({ uid: uid(162, 60), parentUid: CHAT_MESSAGES_UID }), true, "a static line");
    assert.equal(isChatMessageAreaWidget({ uid: 10_658_005, parentUid: CHAT_MESSAGES_UID }), true, "a dynamic line");
    const elsewhere = {
        "a tab button": { uid: uid(162, 4), parentUid: uid(162, 1) },
        "the input line": { uid: uid(162, 58), parentUid: uid(162, 57) },
        "the scrollbar": { uid: 10_660_000, parentUid: uid(162, 560) },
        "an inventory slot": { uid: uid(149, 0), parentUid: uid(161, 70) },
    };
    for (const [name, widget] of Object.entries(elsewhere)) {
        assert.equal(isChatMessageAreaWidget(widget), false, name);
    }
}

// Without the message area, the chatbox's buttons still block and the lines no longer do.
{
    const background = { uid: CHAT_BACKGROUND_UID, eventHandlers: { onClick: [1] } };
    const line = { uid: uid(162, 60), parentUid: CHAT_MESSAGES_UID, flags: 2, actions: ["Add friend"] };
    const tab = { uid: uid(162, 4), parentUid: uid(162, 1), actions: ["Switch tab"] };
    const throughLines = (hits: any[]) => hits.filter((hit) => !isChatMessageAreaWidget(hit));
    assert.equal(findBlockingWidgetInHits([background, line]), line, "today's chatbox blocks");
    assert.equal(findBlockingWidgetInHits(throughLines([background, line])), null, "a click-through one lets it go");
    assert.equal(findBlockingWidgetInHits(throughLines([background, tab])), tab, "a tab still blocks");
}

// A chat line's entries join the world menu: no Cancel, each run through the line's own menu.
{
    const invoked: number[] = [];
    let clicked = 0;
    const entries: SimpleMenuEntry[] = [
        { option: "Add friend", target: "tilecheck", menuStateIndex: 0 },
        { option: "Report", target: "tilecheck", onClick: () => clicked++ },
        { option: "Cancel", menuStateIndex: 2 },
    ];
    const world = asWorldMenuEntries(entries, (index) => invoked.push(index));
    assert.deepEqual(world.map((entry) => entry.option), ["Add friend", "Report"]);
    assert.ok(world.every((entry) => entry.menuStateIndex === undefined), "no index into the world menu's state");
    world[0].onClick?.(1, 2);
    world[1].onClick?.(1, 2);
    assert.deepEqual(invoked, [0]);
    assert.equal(clicked, 1);
}

console.log("chatbox click-through tests passed");
