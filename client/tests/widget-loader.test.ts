import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { WidgetLoader } from "../widgets/WidgetLoader";
import { WidgetManager } from "../widgets/WidgetManager";
import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";
import { shouldTransmitAction } from "../widgets/WidgetFlags";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const cache = CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files);
const bank = new WidgetLoader(cache).loadWidgetGroup(12);
// The bank's one model component (rev 241: 12:62 under 12:61; 12:55 under 12:54 before).
const model = bank?.widgets.get((12 << 16) | 62);

assert.ok(model, "bank widget 12:62 should decode");
assert.equal(model.type, 6);
assert.equal(model.parentUid, (12 << 16) | 61);
assert.equal(model.modelId, -1);

// Exercise the plugin's actual flag packets against the current cache decoder:
// using op2 flags on these op1 widgets used to leave only Cancel in the menu.
const Events = require("../../server/plugins/npcs/random-events/Common.RandomEvents");
const { Location } = require("../../server/dist/game/model/Location");
const manager = new WidgetManager(cache, new WidgetLoader(cache));
const location = new Location(3222, 3222, 0);
const attributes = new Map<string, unknown>();
const persistedAttributes = new Map<string, unknown>();
let npc: any, interfaceId = -1;
const player = {
    isRegistered: () => true, getHitpoints: () => 10, busy: () => false,
    getLocation: () => location, getUsername: () => "WidgetTest",
    getAttribute: (key: string) => attributes.get(key),
    setAttribute(key: string, value: unknown) {
        if (value == null) attributes.delete(key); else attributes.set(key, value);
    },
    getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
    getInterfaceId: () => interfaceId, sendMessage() {},
    getPacketSender: () => ({
        sendInterface(group: number) { interfaceId = group; manager.getGroup(group); },
        sendInterfaceRemoval() { interfaceId = -1; },
        sendString(text: string, uid: number) { manager.getWidgetByUid(uid)!.text = text; },
        sendItemOnInterfaces(uid: number, id: number) { manager.getWidgetByUid(uid)!.itemId = id; },
        sendInterfaceFlagsRange(uid: number, from: number, to: number, flags: number) {
            for (let slot = from; slot <= to; slot++) manager.setWidgetFlagsByKey(uid, slot, flags);
        },
    }),
};
Events.initialize({
    core: { Location,
        NpcIdentifiers: require("../../server/dist/util/NpcIdentifiers").NpcIdentifiers,
        ItemIdentifiers: require("../../server/dist/util/ItemIdentifiers").ItemIdentifiers },
    persistAttribute(key: string, defaultValue?: unknown) { persistedAttributes.set(key, defaultValue); },
    emitCustomEvent() {}, getRegionManager: () => ({ blocked: () => false, canMovestart: () => true }),
    spawnNpc(definition: any) {
        return npc = { getOwner: () => definition.owner, getLocation: () => location,
            setFollowing() {}, setMobileInteraction() {}, forceChat() {} };
    },
    removeNpc() {},
});
assert.ok(persistedAttributes.has("random-events:next-at"), "cooldown must be registered for persistence");
assert.equal(persistedAttributes.get("random-events:return-location"), null);
for (const [index, group, children] of [[1, 297, [6, 7, 8, 9, 10, 11, 12]], [4, 184, [8, 9, 10]]] as const) {
    Events.spawnCommand({ player, parts: ["randevt", String(index)] });
    Events.talk({ player, npc });
    assert.equal(interfaceId, group, "the real event must open the interface under test");
    for (const child of children) {
        const widget = manager.getWidgetByUid((group << 16) | child)!;
        const flags = manager.getWidgetFlags(widget);
        const entries = deriveMenuEntriesForWidget(widget, false, w => manager.getWidgetFlags(w));
        const action = entries.find(entry => entry.option !== "Cancel");
        assert.ok(action, `${group}:${child} must offer its cache action`);
        assert.equal(action.opIndex, 1, `${group}:${child} selects via op1`);
        assert.ok(shouldTransmitAction(flags, action.opIndex! - 1), "selection must reach the server");
    }
}
Events.shutdown();
console.log("Widget loader regression test passed");
