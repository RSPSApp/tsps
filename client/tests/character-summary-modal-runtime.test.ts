import assert from "node:assert/strict";
import { setCustomInterface } from "../common/gamemode/GamemodeContentStore";
import { CustomInterfaceRuntime } from "../widgets/custom/CustomInterfaceRuntime";

const Summary = require("../../server/plugins/interface/sidejournaldefaults/Summary.SideJournalDefaults");
const SummaryLayout = require("../../server/plugins/interface/sidejournaldefaults/Layout.SideJournalDefaults");
const Commands = require("../../server/plugins/interface/Commands.plugin");
const Teleports = require("../../server/plugins/interface/teleportinterface/Layout.TeleportInterface");
const MAIN_MODAL = (161 << 16) | 16;
const JOURNAL_CONTENT = (629 << 16) | 43;

for (const name of ["Commands", "Teleports"]) {
    const definitions = new Map<number, any>();
    const widgets = new Map<number, any>();
    const attachments = new Map<number, number>();
    const events = new Map<string, Array<(event: any) => void>>();
    const transitions: Array<[string, number]> = [];
    let modalId = -1;
    const runtime = new CustomInterfaceRuntime({
        widgetManager: {
            getWidgetByUid: (uid: number) => widgets.get(uid),
            getInterfaceParentContainerUid: (groupId: number) => attachments.get(groupId),
            invalidateWidgetRender() {}, invalidateWidget() {}, invalidateScroll() {},
        } as any,
        getCacheSystem: () => undefined,
        runWidgetScopedClientScript() {},
    });
    const register = (definition: any) => {
        definitions.set(definition.groupId, definition);
        setCustomInterface(definition);
        for (const widget of definition.widgets) {
            widgets.set(widget.uid, { ...widget, width: widget.width || 200, height: widget.height || 100, scrollY: 0 });
        }
    };
    const emit = (event: string, payload: any) => {
        for (const handler of events.get(event) ?? []) handler(payload);
    };
    const sender = {
        sendInterfaceRemoval() {
            transitions.push(["close", modalId]);
            attachments.delete(modalId);
            runtime.onInterfaceClosed(modalId);
            modalId = -1;
            return this;
        },
        sendSubInterface(target: number, groupId: number) {
            transitions.push(["open", groupId]);
            attachments.set(groupId, target);
            runtime.onInterfaceOpened(groupId);
            return this;
        },
        sendString(text: string, uid: number) {
            runtime.handleSetText(uid, text);
            widgets.get(uid).text = text;
            return this;
        },
        sendInterfaceDisplayState() {}, sendInterfacePosition() {},
    };
    const player = {
        getInterfaceId: () => modalId,
        getPacketSender: () => sender,
        getDisplayName: () => "Runtime test",
        getAttribute: () => undefined,
        getInventory: () => ({ getValidItems: () => [] }),
    };
    const api: any = {
        core: { Bank: { TOTAL_BANK_TABS: 0 }, ItemIdentifiers: {}, CustomInterfaceRegistry: { get: (id: number) => definitions.get(id) } },
        registerCustomInterface: register,
        registerCommand() {}, persistAttribute() {}, onCanGainExperience() {}, onPlayerProcess() {}, onPlayerLogout() {}, onInterfaceActionButton() {},
        getRegisteredCommands: () => ["commands", "teleports", "presets", "lockxp"].map(command => ({ command })),
        onCustomEvent(event: string, handler: (event: any) => void) { events.set(event, [...(events.get(event) ?? []), handler]); },
        emitCustomEvent: emit,
    };
    Commands.register(api);
    const commandsGroup = Commands._test.GROUP_ID;
    register(Teleports.buildInterface(["All", "Favourites", "Recent"]));
    Summary(api);
    const definition = definitions.get(name === "Commands" ? commandsGroup : Teleports.GROUP_ID);
    const uid = (component: number) => (definition.groupId << 16) | component;
    const openModal = () => {
        modalId = definition.groupId;
        sender.sendSubInterface(MAIN_MODAL, modalId);
        sender.sendString(JSON.stringify([{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }]), uid(definition.search.dataComponent));
        assert.equal(runtime.handleSearchKeyEvents([{ keyTyped: 0, keyPressed: 97 }]), true, `${name} accepts typing`);
        assert.match(widgets.get(uid(definition.search.inputComponent)).text, /a/);
        if (definition.tabs) {
            sender.sendString(JSON.stringify({ active: 0, tabs: [[1], [2], [1, 2]] }), uid(definition.tabs.layoutComponent));
            runtime.handleWidgetOp(definition.groupId, definition.tabs.components[1]);
            assert.match(widgets.get(uid(definition.tabs.labelComponents[1])).text, /ffffff/);
        }
    };
    openModal();
    const before = transitions.length;
    const request = { player, groupId: 712, tabIndex: 0 };
    emit("side-journal:resolve-content", request);
    sender.sendSubInterface(JOURNAL_CONTENT, request.groupId);
    emit("side-journal:mounted", request);
    assert.equal(modalId, -1, `${name} must close before summary replaces the runtime`);
    assert.equal(attachments.has(definition.groupId), false, "no visible inactive modal remains");
    assert.deepEqual(transitions.slice(before), [["close", definition.groupId], ["open", SummaryLayout.GROUP_ID]]);
    runtime.tick();
    const view = widgets.get(SummaryLayout.uid(SummaryLayout.COMPONENT.VIEW));
    assert.ok(view.scrollHeight > view.height, "summary scrolling is initialized");
    openModal();
    runtime.onInterfaceClosed(definition.groupId);
}
console.log("Character Summary closes Commands/Teleports before runtime replacement; reopening restores search and tabs");
