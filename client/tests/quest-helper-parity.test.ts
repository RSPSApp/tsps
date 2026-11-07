import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { GameTick, PluginMessage } from "@runelite/api/events";
import { QuestHelperPlugin } from "../game/plugins/questhelper/QuestHelperPlugin";
import { QuestHelperPanel, defaultSettings } from "../game/plugins/questhelper/QuestHelperPanel";
import { parseHelperCatalog, parseHelperResponse } from "../game/plugins/questhelper/QuestHelperProtocol";
import { normalizeQuestName, passesSkillFilter, questListSections } from "../game/plugins/questhelper/QuestHelperOrdering";
import { questListMenuEntries } from "../game/plugins/questhelper/QuestHelperMenus";
import { applyChoiceRules, highlightedItems, wrapText } from "../game/plugins/questhelper/QuestHelperOverlays";
import { setQuestWorldMapPoint } from "../game/plugins/questhelper/QuestHelperWorldMap";
import { TileHighlightManager } from "../game/highlights/TileHighlightManager";
import { Inventory } from "../rs/inventory/Inventory";
import { state as network } from "../network/serverConnection/state";
import { parsePluginMessage } from "../common/network/PluginMessage";
import { retainedInventory } from "../game/sync/InventoryStopTransmit";

const step: any = { id: "s", text: ["Talk to the cook."], targets: [{ kind: "npc", id: 4626, x: 3209, y: 3215, plane: 0 }], requirements: [{ name: "Egg", met: false, state: "partial", ids: [1944], quantity: 1 }],
    dialogueChoices: [], widgets: [], overlays: [], recommended: [], teleports: [{ name: "Lumbridge teleport", met: true, ids: [8008] }], inventoryHighlights: [1944],
    choiceRules: [{ groupId: 219, childId: 1, number: true, text: "What's wrong?" }] };
const section = (index: number, active: boolean, extra: any = {}): any => ({ index, title: `Section ${index}`, hidden: false, active, lockable: false, requirements: [], recommended: [], steps: [{ text: [`Step ${index}`], active, faded: false }], ...extra });
const result: any = { protocol: 1, session: "s", sequence: 1, questKey: "cooks_assistant", sourceCommit: "abc", status: "active", activeStep: step, panels: [], diagnostics: [],
    overview: { name: "Cook's Assistant", difficulty: "NOVICE", wikiUrl: "https://oldschool.runescape.wiki/w/Cook%27s_Assistant", itemRequirements: [{ name: "Egg", met: false, state: "fail" }], combatRequirements: [], notes: ["Note one"], rewards: [{ type: "QUEST_POINT", text: "1 Quest Point" }, { type: "EXPERIENCE", text: "300 Cooking Experience" }] },
    sections: [section(0, true), section(1, false, { lockable: true, locked: false, unlockable: true, children: [section(2, false)] }), section(3, false, { hidden: true })],
    overlayPanel: [{ kind: "line", left: "Cook's Assistant", leftColor: "#ffffff" }] };

// Protocol: the new sidebar parts are optional and validated.
assert.ok(parseHelperResponse(result), "overview, sections, overlay panel and choice rules parse");
assert.ok(parseHelperResponse({ ...result, overview: undefined, sections: undefined, overlayPanel: undefined }), "an older engine without them still parses");
assert.equal(parseHelperResponse({ ...result, sections: [{ ...section(0, true), steps: "x" }] }), null);
assert.equal(parseHelperResponse({ ...result, activeStep: { ...step, choiceRules: [{ groupId: "219" }] } }), null);
assert.equal(parseHelperResponse({ ...result, activeStep: { ...step, requirements: [{ name: "x", met: true, state: "maybe" }] } }), null);
// A requirement may carry its item's wiki URL (QuestRequirementsPanel's "Go to wiki..").
const cited = { ...result, activeStep: { ...step, requirements: [{ name: "Redberries", met: false, state: "fail", ids: [1951], quantity: 1, wikiUrl: "https://oldschool.runescape.wiki/w/Redberries#Item_sources" }] } };
assert.ok(parseHelperResponse(cited), "a requirement with a wiki URL parses");
assert.equal(parseHelperResponse({ ...result, activeStep: { ...step, requirements: [{ name: "x", met: false, wikiUrl: 5 }] } }), null, "a non-string wiki URL is rejected");
assert.equal(parseHelperCatalog({ protocol: 1, sourceCommit: "a", diagnostics: [], quests: [{ questKey: "a", name: "A", supported: true, optimalOrder: "1" }] }), null);

// QuestOrdering / QuestFilter / Difficulty / SkillFiltering.
assert.equal(normalizeQuestName("The Restless Ghost"), "Restless Ghost");
const quests: any[] = [
    { questKey: "a", name: "The Restless Ghost", supported: true, questType: "F2P", difficulty: "NOVICE", optimalOrder: 2, releaseOrder: 1, questPoints: 1, status: "NOT_STARTED", filterSkills: ["Prayer"] },
    { questKey: "b", name: "Druidic Ritual", supported: true, questType: "P2P", difficulty: "NOVICE", optimalOrder: 0, releaseOrder: 5, questPoints: 4, status: "FINISHED", filterSkills: ["Herblore"] },
    { questKey: "c", name: "Alfred Grimhand's Barcrawl", supported: true, questType: "MINIQUEST", difficulty: "MINIQUEST", optimalOrder: 1, releaseOrder: 3, status: "NOT_STARTED", filterSkills: [] },
    { questKey: "d", name: "Eadgar's Ruse", supported: true, questType: "P2P", difficulty: "EXPERIENCED", optimalOrder: 3, releaseOrder: 2, questPoints: 1, status: "IN_PROGRESS", filterSkills: [], requiredQuests: ["Druidic Ritual"] },
];
const names = (sections: { title: string; quests: any[] }[]) => sections.map(s => `${s.title}:${s.quests.map(q => q.questKey).join("")}`);
const base = { orderListBy: "A_TO_Z", filterListBy: "SHOW_ALL", difficulty: "ALL", showCompletedQuests: false };
assert.deepEqual(names(questListSections(quests, base)), ["Quests:da", "Miniquests:c"], "A to Z by normalized name, completed hidden, grouped into sections");
assert.deepEqual(names(questListSections(quests, { ...base, showCompletedQuests: true, orderListBy: "OPTIMAL" })), ["Optimal ordering:bcad"]);
assert.deepEqual(names(questListSections(quests, { ...base, orderListBy: "RELEASE_DATE" })), ["Quests:ad", "Miniquests:c"]);
assert.deepEqual(names(questListSections(quests, { ...base, showCompletedQuests: true, orderListBy: "QUEST_POINTS_DESC" })), ["Quests:bda"], "ties sort by name");
assert.deepEqual(names(questListSections(quests, { ...base, filterListBy: "MEMBERS" })), ["Quests:d"]);
assert.deepEqual(names(questListSections(quests, { ...base, difficulty: "NOVICE" })), ["Quests:a"]);
assert.deepEqual(names(questListSections(quests, { ...base, filteredSkills: new Set(["Herblore"]) })), ["Quests:a", "Miniquests:c"], "a quest requiring a quest with a filtered skill is hidden too");
assert.ok(passesSkillFilter(quests[0], quests, new Set()));
assert.deepEqual(names(questListSections(quests, { ...base, search: "ghost" })), [":a"], "a search ignores the sections");

// QuestMenuHandler on the quest list.
const read = [{ option: "Read journal:", target: "<col=ff9040>Recipe for Disaster</col>" }, { option: "Cancel" }];
const rfd: any[] = ["RECIPE_FOR_DISASTER_START", "RECIPE_FOR_DISASTER_DWARF"].map(v => ({ questKey: "recipe_for_disaster", name: "Recipe for Disaster", helperVariant: v, supported: true, status: "IN_PROGRESS" }));
let chosen: any[] = [];
let menu = questListMenuEntries(read as any, rfd, "", undefined, (...args) => chosen = args);
assert.deepEqual(menu.map(e => e.option), ["Read journal:", "Start Quest Helper", "Start Quest Helper", "Cancel"], "each RFD route gets a start entry under Read journal");
assert.equal(menu[2].target, "<col=ff9040>Recipe for Disaster — Mountain Dwarf</col>");
menu[2].onClick!(); assert.deepEqual(chosen, ["recipe_for_disaster", "RECIPE_FOR_DISASTER_DWARF"]);
menu = questListMenuEntries(read as any, rfd, "recipe_for_disaster", "RECIPE_FOR_DISASTER_START", (...args) => chosen = args);
assert.deepEqual(menu.map(e => e.option), ["Read journal:", "Stop Quest Helper", "Cancel"]);
menu[1].onClick!(); assert.deepEqual(chosen, [""]);
assert.equal(questListMenuEntries(read as any, rfd.map(q => ({ ...q, status: "FINISHED" })), "", undefined, () => {}).length, 2, "finished quests get no entry");

// WidgetChoiceStep.highlightChoice on live widgets.
const option = (text: string, childIndex: number): any => ({ text, childIndex, color: 0, textColor: 0, _absX: 0, _absY: childIndex * 20, _absWidth: 100, _absHeight: 20 });
const options = [option("Select an option", 0), option("What's wrong?", 1), option("Bye.", 2)];
const invalidated: any[] = [];
const manager: any = { findLoadedWidget: (g: number, c: number) => (g === 219 && c === 1 ? { uid: 1 } : undefined), isEffectivelyHidden: () => false, getDynamicChildrenByParent: () => options, getStaticChildrenByParentUid: () => [], invalidateWidgetRender: (w: any) => invalidated.push(w) };
applyChoiceRules(manager, step.choiceRules, 0xff0000ff, { x: 500, y: 500 });
assert.equal(options[1].text, "[1] What's wrong?"); assert.equal(options[1].color, 0x0000ff);
applyChoiceRules(manager, step.choiceRules, 0xff0000ff);
assert.equal(options[1].text, "[1] What's wrong?", "numbered once");
options[1].color = 0xffffff;
applyChoiceRules(manager, step.choiceRules, 0xff0000ff, { x: 5, y: 25 });
assert.equal(options[1].color, 0xffffff, "the hover colour stays while the mouse is over the option");
applyChoiceRules(manager, [{ groupId: 219, childId: 1, number: true, text: "Bye.", replace: "Leave" }], 0xff0000ff);
assert.equal(options[2].text, "[2] Leave", "DialogChoiceChange replaces the text");
assert.equal(applyChoiceRules(manager, [{ groupId: 219, childId: 1, number: false, text: "Bye.", excludeGroupId: 219, excludeChildId: 1, excludes: ["Select"] }], 0xff0000ff).length, 0, "an exclusion stops the highlight");

// DetailedQuestStep.makeWidgetOverlayHint's item ids: teleports only far from the step.
const near = highlightedItems(step, { localPlayer: { x: 3210, y: 3215, plane: 0 } } as any);
assert.deepEqual([...near.inventory], [1944]); assert.deepEqual([...near.bank], [1944]);
assert.deepEqual([...highlightedItems(step, { localPlayer: { x: 3000, y: 3500, plane: 0 } } as any).inventory], [1944, 8008]);

assert.deepEqual(wrapText("<col=ff0000>Speak to</col> the Cook in Lumbridge", 60, s => s.length * 6), ["Speak to", "the Cook", "in", "Lumbridge"]);

// World map point: set, kept for others, cleared.
const mapClient: any = { pluginWorldMapPoints: [{ owner: "other", x: 1, y: 1, plane: 0 }] };
setQuestWorldMapPoint(mapClient, { x: 3209, y: 3215, plane: 0 }, 0xff00ffff);
assert.equal(mapClient.pluginWorldMapPoints.length, 2);
setQuestWorldMapPoint(mapClient, undefined, 0);
assert.deepEqual(mapClient.pluginWorldMapPoints.map((p: any) => p.owner), ["other"]);

// Overview and sections, as QuestOverviewPanel / QuestStepPanel show them.
const panelState: any = { selected: "cooks_assistant", status: "Guided route active", result, catalog: { sourceCommit: "abc", quests: [{ questKey: "cooks_assistant", name: "Cook's Assistant", supported: true }] } };
const locks: any[] = [];
const panelPlugin: any = { getState: () => panelState, subscribe: () => () => {}, selectQuest() {}, retry() {}, getConfig: () => ({ ...defaultSettings(), hideQuestRewards: false }), lockSection: (...a: any[]) => locks.push(a) };
let html = renderToStaticMarkup(createElement(QuestHelperPanel, { plugin: panelPlugin }));
assert.match(html, /Quest overview/); assert.match(html, /Section 0/); assert.match(html, /Section 1/); assert.ok(!html.includes("Section 3"), "hidden sections are not shown");
assert.match(html, /rl-qh-active/, "the current section is highlighted"); assert.match(html, /aria-current="step"/);
assert.match(html, /Mark section as complete/, "lockable sections get the lock box");
assert.match(html, /color:#ffffff[^>]*>.*Egg/, "a partially passed requirement uses the partial colour");
panelPlugin.getConfig = () => ({ ...defaultSettings(), hideQuestRewards: true });
html = renderToStaticMarkup(createElement(QuestHelperPanel, { plugin: panelPlugin }));
assert.ok(!html.includes("300 Cooking Experience"));

async function main(): Promise<void> {
    Object.assign(globalThis, { WebSocket: { OPEN: 1 } });
    const requests: any[] = [];
    network.socket = { readyState: 1, send: (bytes: Uint8Array) => requests.push(parsePluginMessage(bytes.subarray(3)).data) } as any;
    network.lastSkillsState = { combatLevel: 3, totalLevel: 1, byId: new Map([[0, { id: 0, baseLevel: 1, currentLevel: 1, xp: 0, boost: 0, virtualLevel: 1 }]]) } as any;
    const bus = new EventBus(), config = new ConfigManager(bus), manager = new PluginManager(bus, config);
    config.setConfiguration("questhelper", "showOverlays", "false");
    config.setConfiguration("questhelper", "highlightColor", "#123456");
    config.setConfiguration("questhelper", "highlightTiles", "false");
    const player: any = { getIndexForServerId: () => 0, getLevel: () => 0, getAnimActionSeqId: () => -1, getAnimMovementSeqId: () => -1, getRotation: () => 0, getInteractionIndex: () => -1 };
    const bank = new Inventory(1410);
    const client: any = { stateMachine: { getState: () => 30 }, localPlayerName: "A", getControlledPlayerMovementTile: () => ({ tileX: 3200, tileY: 3200 }), controlledPlayerServerId: 1, playerEcs: player, tileHighlightManager: new TileHighlightManager(),
        varManager: { values: new Int32Array(1), customVarbits: new Map(), varbitLoader: { load: () => undefined }, varpChangeListeners: new Set() }, inventory: new Inventory(), equipment: new Inventory(14), bankInventory: bank, lastKnownBank: retainedInventory(bank),
        npcEcs: { forEachActive: () => {}, mutationListeners: new Set() }, renderer: { getLocIdsAtTileAllLevels: () => [], canvas: { width: 765, height: 503 } }, groundItems: { getAllStacks: () => [], mutationListeners: new Set() },
        widgetManager: { rootInterface: -1, interfaceParents: new Map(), getAllGroupRoots: () => [], groupLoadedListeners: new Set(), interfaceClosedListeners: new Set() } };
    manager.getInjector().provide(CLIENT_TOKEN, client);
    manager.loadCorePlugins([QuestHelperPlugin]);
    const plugin = manager.getPlugin(QuestHelperPlugin)!;
    await manager.setPluginEnabled(QuestHelperPlugin, false);
    await manager.setPluginEnabled(QuestHelperPlugin, true);
    const settings = plugin.getConfig();
    assert.equal(settings.solvePuzzles, false, "the earlier puzzle-overlay switch carries over");
    assert.equal(settings.targetOverlayColor, 0xff123456, "the earlier highlight colour carries over, opaque");
    assert.equal(settings.highlightStyleNpcs, "NONE", "highlighting turned off stays off");
    assert.equal(config.getConfiguration("questhelper", "showOverlays"), undefined, "legacy keys are removed");

    network.lastRunEnergyState = { weight: 2.5 } as any; client.inputManager = { mouseX: 1, mouseY: 1 }; client.playerEcs.getAppearance = () => ({ gender: 0 });
    plugin.selectQuest("cook");
    bus.post(new GameTick());
    if (!requests.some(r => r.type === "evaluate")) throw new Error(`${plugin.getState().status} started=${plugin.isStarted()} enabled=${plugin.isEnabled()}`);
    const request = requests.find(r => r.type === "evaluate");
    assert.equal(request.config.solvePuzzles, false, "engine settings ride with the evaluation");
    assert.equal(request.config.stewBoostsPanel, false, "under their upstream key names");
    assert.equal(request.config.passColour, 0xff00ff00);
    plugin.lockSection(1, true);
    bus.post(new PluginMessage("quest-helper", { ...result, type: "result", session: request.session, sequence: request.sequence, questKey: "cook" }));
    const nativeNow = Date.now; Date.now = () => nativeNow() + 2000;
    bus.post(new GameTick());
    Date.now = nativeNow;
    assert.deepEqual(requests.filter(r => r.type === "evaluate").at(-1).lockSection, { section: 1, locked: true }, "a section lock is sent once");

    plugin.applyAssistance("minimum");
    assert.equal(plugin.getConfig().showOverlay, false); assert.equal(plugin.getConfig().highlightStyleInventoryItems, "NONE"); assert.ok(plugin.assistanceChosen());
    assert.equal(plugin.assistanceLevel(), "minimum");
    plugin.setSkillFiltered("Herblore", true);
    assert.deepEqual([...plugin.filteredSkills()], ["Herblore"]);

    // Autostart: a quest that goes from not started to started becomes the guide.
    plugin.selectQuest("");
    bus.post(new GameTick());
    const catalogRequest = requests.filter(r => r.type === "catalog").at(-1);
    const catalog = { type: "catalog", protocol: 1, session: catalogRequest.session, sourceCommit: "abc", diagnostics: [], quests: [{ questKey: "sheep", name: "Sheep Shearer", supported: true, helperVariant: "SHEEP_SHEARER", status: "NOT_STARTED" }] };
    bus.post(new PluginMessage("quest-helper", catalog));
    assert.equal(plugin.getState().selected, "");
    bus.post(new PluginMessage("quest-helper", { ...catalog, quests: [{ ...catalog.quests[0], status: "IN_PROGRESS" }] }));
    assert.equal(plugin.getState().selected, "sheep", "starting a quest in game starts its helper");
    assert.equal(plugin.getState().variant, "SHEEP_SHEARER");

    await manager.setPluginEnabled(QuestHelperPlugin, false);
    network.socket = null as any; network.lastSkillsState = undefined; network.lastRunEnergyState = undefined;
    console.log("quest helper upstream parity (sidebar, list, menus, choices, items, settings) passed");
}
void main();
