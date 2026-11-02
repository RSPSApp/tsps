import assert from "node:assert/strict";
import path from "node:path";

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

// Legacy quest interfaces store parents per component, with no child list after
// a type-0 container. Reading a child count there discarded these real widgets.
const questLoader = new WidgetLoader(cache);
for (const groupId of [113, 480]) {
    const group = questLoader.loadWidgetGroup(groupId);
    assert.ok(group, `quest interface ${groupId} must decode`);
    const containers = [...group.widgets.values()].filter(widget => widget.type === 0);
    assert.ok(containers.length > 0, `quest interface ${groupId} must retain its containers`);
    for (const widget of group.widgets.values()) {
        if (widget.parentUid !== -1) {
            assert.ok(group.widgets.has(widget.parentUid), `${groupId}:${widget.fileId} retains its parent`);
        }
    }
}
assert.equal(questLoader.loadWidgetGroup(480)!.widgets.size, 59, "all Animal Magnetism components decode");
for (const child of [23, 24]) {
    const widget = questLoader.loadWidgetGroup(480)!.widgets.get((480 << 16) | child)!;
    const entry = deriveMenuEntriesForWidget(widget).find(option => option.option === widget.buttonText);
    assert.ok(entry, `480:${child} must offer its legacy ${widget.buttonText} button`);
    assert.equal(entry.opIndex, 1);
    assert.ok(shouldTransmitAction(widget.flags ?? 0, 0), "legacy button must reach its server handler");
}

// Exercise the plugin's actual flag packets against the current cache decoder:
// using op2 flags on these op1 widgets used to leave only Cancel in the menu.
const Events = require("../../server/plugins/npcs/random-events/Common.RandomEvents");
async function verifyEventWidgets() {
    // Server objects load server-relative world data. Each client test is run in
    // its own process; restore the caller's directory even if an assertion fails.
    const clientDirectory = process.cwd();
    try {
        process.chdir(path.resolve(__dirname, "../../server"));
        require("../../server/dist/Server").Server.installProductionPathResolver();
        const { CachePipeline } = require("../../server/dist/game/cache/CachePipeline");
        await CachePipeline.initialize(process.cwd());
        const { Location } = require("../../server/dist/game/model/Location");
        const { NPC } = require("../../server/dist/game/entity/impl/npc/NPC");
        const { DialogueManager } = require("../../server/dist/game/model/dialogues/DialogueManager");
        const { DialogueChainBuilder } = require("../../server/dist/game/model/dialogues/builders/DialogueChainBuilder");
        const { NpcDialogue } = require("../../server/dist/game/model/dialogues/entries/impl/NpcDialogue");
        const { ActionDialogue } = require("../../server/dist/game/model/dialogues/entries/impl/ActionDialogue");
        const { EndDialogue } = require("../../server/dist/game/model/dialogues/entries/impl/EndDialogue");
        const manager = new WidgetManager(cache, new WidgetLoader(cache));
        const location = new Location(3222, 3222, 0);
        const attributes = new Map<string, unknown>();
        const persistedAttributes = new Map<string, unknown>();
        let npc: any, interfaceId = -1, chatboxGroupId = -1;
        const player = {
            isRegistered: () => true, getHitpoints: () => 10, busy: () => false,
            getLocation: () => location, getUsername: () => "WidgetTest",
            getAttribute: (key: string) => attributes.get(key),
            setAttribute(key: string, value: unknown) {
                if (value == null) attributes.delete(key); else attributes.set(key, value);
            },
            getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
            getInterfaceId: () => interfaceId, sendMessage() {},
            getDialogueManager: () => dialogueManager,
            getPacketSender: () => ({
                sendInterface(group: number) { interfaceId = group; manager.getGroup(group); return this; },
                sendInterfaceRemoval() { interfaceId = -1; return this; },
                sendChatboxInterface(group: number) { chatboxGroupId = group; manager.getGroup(group); return this; },
                isChatboxInterface(group: number) { return chatboxGroupId === group; },
                sendNpcHeadOnInterface(id: number, uid: number) { manager.getWidgetByUid(uid)!.modelId = id; return this; },
                sendInterfaceAnimation() { return this; },
                sendClientScript() { return this; },
                sendString(text: string, uid: number) { manager.getWidgetByUid(uid)!.text = text; return this; },
                sendItemOnInterfaces(uid: number, id: number) { manager.getWidgetByUid(uid)!.itemId = id; return this; },
                sendInterfaceRawModel(uid: number, model: number) { manager.getWidgetByUid(uid)!.modelId = model; return this; },
                sendGlobalGraphic() { return this; },
                sendAreaSound() { return this; },
                sendTypedMessage() { return this; },
                sendInterfaceFlagsRange(uid: number, from: number, to: number, flags: number) {
                    for (let slot = from; slot <= to; slot++) manager.setWidgetFlagsByKey(uid, slot, flags);
                    return this;
                },
            }),
        };
        // Keep the view/packet adapter local, but use the production NPC and dialogue
        // lifecycle: the Sandwich Lady's tray must wait for the native Continue input.
        const dialogueManager = new DialogueManager(player);
        Events.initialize({
            core: { Location, DialogueChainBuilder, NpcDialogue, ActionDialogue, EndDialogue,
                Graphic: require("../../server/dist/game/model/Graphic").Graphic,
                NpcDefinition: require("../../server/dist/game/definition/NpcDefinition").NpcDefinition,
                World: { forEachNetworkPlayer() {} },
                NpcIdentifiers: require("../../server/dist/util/NpcIdentifiers").NpcIdentifiers,
                ItemIdentifiers: require("../../server/dist/util/ItemIdentifiers").ItemIdentifiers,
                MapObjects: { mapObjects: new Map(), getHash: () => 0 },
                Wilderness: { isPvpArea: () => false } },
            persistAttribute(key: string, defaultValue?: unknown) { persistedAttributes.set(key, defaultValue); },
            emitCustomEvent() {}, getRegionManager: () => ({ blocked: () => false, canMovestart: () => true }),
            spawnNpc(definition: any) {
                npc = new NPC(definition.id, new Location(definition.x, definition.y, definition.z));
                npc.setOwner(definition.owner);
                return npc;
            },
            removeNpc() {},
        });
        assert.ok(persistedAttributes.has("random-events:next-at"), "cooldown must be registered for persistence");
        assert.equal(persistedAttributes.get("random-events:return-location"), null);
        for (const [index, group, children] of [[1, 297, [6, 7, 8, 9, 10, 11, 12]], [4, 184, [8, 9, 10]]] as const) {
            Events.spawnCommand({ player, parts: ["randevt", String(index)] });
            Events.talk({ player, npc });
            if (index === 1) {
                assert.equal(interfaceId, -1, "the food tray must not open before the spoken offer is continued");
                assert.ok(dialogueManager.getCurrent() instanceof NpcDialogue);
                assert.equal(dialogueManager.getCurrent().getNpcId(), npc.getId());
                assert.equal(chatboxGroupId, NpcDialogue.GROUP_ID);
                assert.equal(manager.getWidgetByUid((NpcDialogue.GROUP_ID << 16) | 2)!.modelId, npc.getId());
                const continueUid = (NpcDialogue.GROUP_ID << 16) | 5;
                assert.equal(manager.getWidgetFlags(manager.getWidgetByUid(continueUid)!) & 1, 1,
                    "the native Continue component must carry the pause-button flag");
                assert.equal(dialogueManager.handleResume((group << 16) | 5, -1), false,
                    "a Continue from the wrong interface must not bypass the spoken offer");
                assert.equal(interfaceId, -1);
                assert.equal(dialogueManager.handleResume(continueUid, -1), true);
            }
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
    } finally {
        process.chdir(clientDirectory);
    }
}
verifyEventWidgets().then(() => console.log("Widget loader regression test passed"))
    .catch(error => { console.error(error); process.exitCode = 1; });
