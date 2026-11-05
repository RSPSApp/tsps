import { strict as assert } from "node:assert";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { GameStateChanged, GameTick, PluginChanged, PluginMessage } from "@runelite/api/events";
import { QuestHelperPlugin } from "../game/plugins/questhelper/QuestHelperPlugin";
import { QuestHelperBankTab, quantityToStackSize } from "../game/plugins/questhelper/QuestHelperBankTab";
import { QuestHelperGrandExchange } from "../game/plugins/questhelper/QuestHelperGrandExchange";
import { GameState } from "@runelite/api/GameState";
import type { HelperBankTab } from "../game/plugins/questhelper/QuestHelperProtocol";
import type { BankTagsClient } from "../game/plugins/banktags/bankClient";
import { Bankmain } from "../game/plugins/banktags/bankmain";
import { TileHighlightManager } from "../game/highlights/TileHighlightManager";
import { Inventory } from "../rs/inventory/Inventory";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { state as network } from "../network/serverConnection/state";
import { parsePluginMessage } from "../common/network/PluginMessage";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

async function main() {
    // --- Use 'Shortest Path' plugin: the engine's messages reach the Shortest Path plugin ---------
    Object.assign(globalThis, { WebSocket: { OPEN: 1 } });
    const requests: any[] = [];
    network.socket = { readyState: 1, send: (bytes: Uint8Array) => requests.push(parsePluginMessage(bytes.subarray(3)).data) } as any;
    network.lastSkillsState = { combatLevel: 3, totalLevel: 1, byId: new Map([[0, { id: 0, baseLevel: 1, currentLevel: 1, xp: 0, boost: 0, virtualLevel: 1 }]]) } as any;
    const bus = new EventBus(), config = new ConfigManager(bus), manager = new PluginManager(bus, config);
    let bankOpen = false;
    const player: any = { getIndexForServerId: () => 0, getLevel: () => 0, getAnimActionSeqId: () => -1, getAnimMovementSeqId: () => -1, getRotation: () => 0, getInteractionIndex: () => -1 };
    const client: any = {
        stateMachine: { getState: () => 30 }, localPlayerName: "A", getControlledPlayerMovementTile: () => ({ tileX: 3200, tileY: 3200 }), controlledPlayerServerId: 1,
        playerEcs: player, tileHighlightManager: new TileHighlightManager(),
        varManager: { values: new Int32Array(1), customVarbits: new Map(), varbitLoader: { load: () => undefined }, varpChangeListeners: new Set() },
        inventory: new Inventory(), equipment: new Inventory(14), bankInventory: new Inventory(1410),
        npcEcs: { forEachActive: () => {}, mutationListeners: new Set() }, renderer: { getLocIdsAtTileAllLevels: () => [], canvas: { width: 765, height: 503 } },
        groundItems: { getAllStacks: () => [], mutationListeners: new Set() },
        widgetManager: {
            rootInterface: -1, interfaceParents: new Map(), getAllGroupRoots: () => [], groupLoadedListeners: new Set(), interfaceClosedListeners: new Set(),
            getWidgetByUid: (uid: number) => (bankOpen && uid === Bankmain.UNIVERSE ? { uid, hidden: false } : undefined),
            isEffectivelyHidden: () => false,
        },
    };
    manager.getInjector().provide(CLIENT_TOKEN, client);
    manager.loadCorePlugins([QuestHelperPlugin]);
    const plugin = manager.getPlugin(QuestHelperPlugin)!;
    await manager.setPluginEnabled(QuestHelperPlugin, true);
    const routes: PluginMessage[] = [];
    bus.subscribe(PluginMessage, (message) => { if (message.namespace === "shortestpath") routes.push(message); });

    plugin.setConfig("useShortestPath", true);
    plugin.selectQuest("cook");
    bus.post(new GameTick());
    let request = requests.filter((r) => r.type === "evaluate").at(-1);
    assert.equal(request.config.useShortestPath, true, "the option goes to the engine as upstream's key");
    assert.equal(request.bankTab, undefined, "no bank tab while the bank is shut");

    const result = (r: any, extra: object) => ({
        type: "result", protocol: 1, session: r.session, sequence: r.sequence, questKey: "cook", sourceCommit: "abc", status: "active",
        activeStep: { id: "talk", text: ["Talk"], targets: [{ kind: "npc", x: 3208, y: 3214, plane: 0 }], requirements: [], dialogueChoices: [], widgets: [], overlays: [] },
        panels: [], diagnostics: [], ...extra,
    });
    const path = { namespace: "shortestpath", name: "path", data: { start: { x: 3200, y: 3200, plane: 0 }, target: { x: 3208, y: 3214, plane: 0 } } };
    bus.post(new PluginMessage("quest-helper", result(request, { pluginMessages: [path] })));
    assert.equal(routes.length, 1);
    assert.deepEqual([routes[0].name, routes[0].data], ["path", path.data], "posted as DetailedQuestStep.setShortestPath posts it");

    // Shortest Path off when the step posted its route: enabling it later still shows that route.
    const shortestPathPlugin: any = { getName: () => "Shortest Path" };
    bus.post(new PluginChanged(shortestPathPlugin, true));
    assert.equal(routes.length, 2, "the route is replayed for a plugin that starts after the step");
    assert.deepEqual([routes[1].name, routes[1].data], ["path", path.data]);
    bus.post(new PluginChanged(shortestPathPlugin, false));
    assert.equal(routes.length, 2, "disabling it replays nothing");

    const bad = { ...path, namespace: "elsewhere" };
    assert.equal(plugin.getState().result?.pluginMessages?.length, 1);
    bus.post(new GameTick());
    request = requests.filter((r) => r.type === "evaluate").at(-1);
    bus.post(new PluginMessage("quest-helper", result(request, { pluginMessages: [bad] })));
    assert.equal(routes.length, 2, "only shortestpath messages are accepted from the engine");

    // Switching quest shuts the old steps down: the route is cleared (removeShortestPath).
    plugin.selectQuest("sheep");
    assert.equal(routes.length, 3);
    assert.equal(routes[2].name, "clear");
    plugin.selectQuest("cook");
    assert.equal(routes.length, 3, "nothing to clear");

    // With the bank open, the engine is asked for the quest bank tab.
    bankOpen = true;
    bus.post(new GameTick());
    request = requests.filter((r) => r.type === "evaluate").at(-1);
    assert.equal(request.bankTab, true);
    await manager.setPluginEnabled(QuestHelperPlugin, false);

    // --- The bank tab against the real bank interface ------------------------------------------
    assert.equal(quantityToStackSize(1234), "1234");
    assert.equal(quantityToStackSize(123456), "123K");
    assert.equal(quantityToStackSize(12345678), "12M");

    const { vm } = createCacheVm();
    const widgets = vm.context.widgetManager;
    const EGG = 1944, MILK = 1927, FLOUR = 1933, COINS = 995, WHIP = 4151;
    const bank = new Inventory(1410);
    [COINS, EGG, WHIP].forEach((id, slot) => bank.setSlot(slot, id, id === COINS ? 500 : 1));
    vm.context.inventories = new Map([[95, bank], [93, new Inventory(28)], [94, new Inventory(14)]]);
    widgets.rootInterface = 161;
    widgets.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent(createScriptEvent({ args: widget.onLoad, widget }), 2000000);
    widgets.onLoadInvoker = (widget: any) => vm.invokeEventHandler(widget, "onLoad");
    const objs = vm.context.objTypeLoader;
    const messages: string[] = [];
    const bankClient: BankTagsClient = {
        widgets, vm,
        getWidget: (id) => widgets.getWidgetByUid(id),
        getItemDefinition: (id) => objs.load(id),
        canonicalize: (id) => id,
        getItemCount: () => objs.getCount(),
        getItemContainer: (id) => vm.context.inventories.get(id),
        getVarbitValue: (id) => vm.context.varManager.getVarbit(id),
        setVarbit: (id, v) => vm.context.varManager.setVarbit(id, v),
        getVarpValue: (id) => vm.context.varManager.getVarp(id),
        getVarcStrValue: (id) => String(vm.context.varManager.getVarcString(id) ?? ""),
        setVarcIntValue: (id, v) => vm.context.varManager.setVarcInt(id, v),
        setVarcStrValue: (id, v) => vm.context.varManager.setVarcString(id, v),
        getEnumIntValue: () => -1,
        runScript: (id, ...args) => vm.run(vm.context.loadScript(id), args.filter((a): a is number => typeof a === "number"), []),
        runListener: (widget, event) => vm.invokeEventHandler(widget, event),
        isShiftPressed: () => false,
        playSoundEffect: () => {},
        sendChatMessage: (m) => messages.push(m),
        getDraggedWidget: () => undefined,
        getDraggedOnWidget: () => undefined,
        setDraggedOnWidget: () => {},
    };
    const item = (id: number, quantity: number, met: boolean, text: string) => ({ quantity, text, itemIds: [id], displayId: id, met });
    const tabData: HelperBankTab = {
        sections: [{ name: "Starting off", items: [item(EGG, 1, true, "Egg"), item(MILK, 1, false, "Bucket of milk"), item(FLOUR, 1, false, "Pot of flour")], recommendedItems: [] }],
        missingItems: [MILK, FLOUR],
    };
    const tab = new QuestHelperBankTab(bankClient, { selectedQuestName: () => "Cook's Assistant", bankTab: () => tabData, sendChatMessage: (m) => messages.push(m) });
    vm.scriptPreListeners.add((id: number) => tab.onScriptPreFired(id));
    vm.scriptPostListeners.add((id: number) => tab.onScriptPostFired(id));
    vm.scriptCallbackListeners.add((_s: unknown, name: string) => tab.onScriptCallback(name));

    for (const root of widgets.getAllGroupRoots(12)) widgets.triggerOnLoad(root);
    const items = widgets.getWidgetByUid(Bankmain.ITEMS)!;
    const build = async () => {
        vm.invokeEventHandler(items, "onInvTransmit");
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await build();
    tab.init();
    const universe = widgets.getWidgetByUid(Bankmain.UNIVERSE)!;
    const button = (universe.children ?? []).find((c: any) => c?.opBase === "quest-helper") as any;
    assert.ok(button, "the quest-helper button by the bank's tabs");
    assert.equal(button.spriteId, 195);
    assert.equal(button.actions[1], "View tab ");

    // View tab: the quest's items in sections, then everything else.
    button.jsListeners.onOp({ widget: button, opIndex: 2 });
    assert.ok(tab.questTabActive);
    assert.equal(button.spriteId, 196, "the selected button");
    await build();
    assert.equal(widgets.getWidgetByUid(Bankmain.TITLE)!.text, "Tab <col=ff0000>Cook's Assistant</col>");
    const kids = (items.children ?? []) as any[];
    const texts = kids.filter((c) => c && c.type === 4 && !c.hidden).map((c) => c.text);
    assert.ok(texts.includes("Starting off") && texts.includes("Non-quest items"), JSON.stringify(texts));
    assert.equal(texts.filter((t) => t === "/ 1").length, 3, "each needed item's goal");
    const shown = kids.slice(0, 5).map((c) => [c.itemId, c.rawX, c.rawY, c.transparency]);
    assert.deepEqual(shown.slice(0, 3).map(([id]) => id), [EGG, MILK, FLOUR], "the section's items first");
    assert.deepEqual(shown[0].slice(1, 3), [51, 20], "under the header (5 + 15)");
    assert.equal(shown[1][3], 120, "a missing item is a placeholder");
    assert.deepEqual(shown.slice(3, 5).map(([id]) => id), [COINS, WHIP], "the rest under Non-quest items");
    const ticks = kids.filter((c) => c && c.type === 5 && (c.spriteId === 1216 || c.spriteId === 1217) && !c.hidden).map((c) => c.spriteId);
    assert.deepEqual(ticks, [1217, 1216, 1216], "a tick for the egg it has, crosses for the rest");

    // Details on a missing item says what's needed; a withdraw goes to the real bank slot.
    assert.equal(kids[1].actions[1], "Details");
    assert.equal(tab.onMenuOptionClicked({ widget: kids[1], option: "Details", target: "", opIndex: 2 } as any), true);
    assert.equal(messages.at(-1), "You need <col=ff0000>1 x Bucket of milk</col>.");
    const withdraw: any = { widget: kids[4], option: "Withdraw-1", slot: 4, opIndex: 1 };
    tab.onMenuOptionClicked(withdraw);
    assert.equal(withdraw.slot, 2, "the whip is in bank slot 2");

    // Another tab closes it; the bank is itself again.
    tab.onMenuOptionClicked({ widget: universe, option: "View all items", target: "" } as any);
    assert.equal(tab.questTabActive, false);
    await build();
    const after = ((items.children ?? []) as any[]).filter((c) => c && c.type === 4 && !c.hidden).map((c) => c.text);
    assert.ok(!after.includes("Starting off"), "the section widgets are removed");
    tab.destroy();
    assert.equal(button.hidden, true);
    // --- The Grand Exchange search ------------------------------------------------------------
    let at = { x: 3164, y: 3489, plane: 0 };
    let stepItems: number[] | undefined;
    const ge = new QuestHelperGrandExchange(bankClient, {
        selectedQuestName: () => "Cook's Assistant",
        solvePuzzles: () => true,
        stepItems: () => stepItems,
        missingItems: () => [FLOUR, MILK, 9999999],
        playerLocation: () => at,
    });
    const tradeable = (id: number) => id !== 9999999;
    assert.equal(ge.notAtGE(), false);
    assert.equal(ge.searchResults("shark", tradeable), undefined, "other searches are the game's");
    assert.deepEqual(ge.searchResults("quest-helper", tradeable), [MILK, FLOUR], "the missing tradeable items, in id order");
    at = { x: 3164 + 21, y: 3489, plane: 0 };
    assert.equal(ge.notAtGE(), true, "more than 20 tiles away");
    stepItems = [EGG];
    assert.deepEqual(ge.searchResults("quest-helper", tradeable), [EGG], "away from it, the step's items");

    // The button sits in the chatbox's message layer, by the item search.
    for (const root of widgets.getAllGroupRoots(162)) widgets.triggerOnLoad(root);
    const layer = widgets.getWidgetByUid((162 << 16) | 39);
    if (layer) {
        layer.hidden = false;
        at = { x: 3164, y: 3489, plane: 0 };
        ge.init();
        const geButton = (layer.children ?? []).find((c: any) => c?.opBase === "quest helper") as any;
        assert.ok(geButton, "the quest helper button at the Grand Exchange");
        assert.equal(geButton.actions[1], "View missing items ");
        geButton.jsListeners.onOp({ widget: geButton, opIndex: 2 });
        assert.equal(ge.active, true);
        assert.equal(vm.context.varManager.getVarcString(359), "quest-helper", "the search the game runs is for quest-helper");
        assert.equal(vm.context.varManager.getVarcInt(5), 14, "in Grand Exchange search mode");
        ge.destroy();
        assert.equal(geButton.hidden, true);
    } else {
        console.warn("chatbox message layer not in this cache build; button layout check skipped");
    }

    // Logging out is removing the guide from the world: the route clears and cannot be replayed.
    bankOpen = false;
    await manager.setPluginEnabled(QuestHelperPlugin, true);
    plugin.setConfig("useShortestPath", true);
    plugin.selectQuest("cook");
    bus.post(new GameTick());
    request = requests.filter((r) => r.type === "evaluate").at(-1);
    bus.post(new PluginMessage("quest-helper", result(request, { pluginMessages: [path] })));
    assert.equal(routes.at(-1)?.name, "path");
    bus.post(new GameStateChanged(GameState.LOGIN_SCREEN));
    assert.equal(routes.at(-1)?.name, "clear", "logging out clears the route");
    const afterLogout = routes.length;
    bus.post(new PluginChanged(shortestPathPlugin, true));
    assert.equal(routes.length, afterLogout, "a logged-out route is not replayed");
    await manager.setPluginEnabled(QuestHelperPlugin, false);

    console.log("quest-helper-integrations tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
