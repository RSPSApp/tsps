import { openClientUrl } from "../common/openUrl";
import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientState } from "../game/ClientState";
import { WikiConfig } from "../game/plugins/wiki/WikiConfig";
import { lookupUrl, pageUrl, searchUrl, WIKI_ICONS, WikiPlugin } from "../game/plugins/wiki/WikiPlugin";
import { MenuTargetType } from "../rs/MenuEntry";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import { menuClickListeners, type MenuActionData } from "../ui/menu/menuEvents";
import { MenuState } from "../ui/menu/MenuState";

// --- Config and URLs -----------------------------------------------------------------------------
assert.equal(WikiConfig.group, "wiki");
assert.equal(WikiConfig.items.showWikiMinimapButton.default, true);
assert.equal(WikiPlugin.descriptor.enabledByDefault, undefined, "on by default, as RuneLite");
assert.equal(lookupUrl({ type: "npc", id: 3106, name: "Man", location: { x: 3211, y: 3227, plane: 0 } }),
    "https://oldschool.runescape.wiki/w/Special:Lookup?type=npc&id=3106&name=Man&x=3211&y=3227&plane=0");
assert.equal(lookupUrl({ type: "item", id: 1351, name: "Bronze axe" }),
    "https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=1351&name=Bronze+axe");
assert.equal(pageUrl("<col=ff981f>Strength</col>"), "https://oldschool.runescape.wiki/w/Strength");
assert.equal(pageUrl("Noxious Foe"), "https://oldschool.runescape.wiki/w/Noxious_Foe");
assert.equal(searchUrl("dragon scimitar"), "https://oldschool.runescape.wiki/?search=dragon+scimitar");

// --- A game client, as far as the plugin reads it --------------------------------------------------
const items: Record<number, any> = {
    1351: { name: "Bronze axe" },
    1352: { name: "Bronze axe", noteTemplate: 799, note: 1351 },
    6512: { name: "null" },
};
const widgets = new Map<number, any>();
const statsUniverse = 320 << 16;
widgets.set((320 << 16) | 2, { uid: (320 << 16) | 2, parentUid: statsUniverse, actions: ["View <col=ff981f>Strength</col> guide"] });
widgets.set((715 << 16) | 9, { uid: (715 << 16) | 9 });
const task = { name: "<col=ff981f>Noxious Foe</col>", actions: ["", "Open"], parentUid: (715 << 16) | 9 };
const client: any = {
    objTypeLoader: { load: (id: number) => items[id] },
    npcEcs: {
        getEcsIdForServer: (sid: number) => (sid === 12 ? 4 : undefined),
        getNpcTypeId: () => 3106,
        getWorldX: () => 3211 << 7,
        getWorldY: () => 3227 << 7,
    },
    npcTypeLoader: { load: () => ({ id: 3106, name: "Man" }) },
    locTypeLoader: {
        load: (id: number) => (id === 10778
            ? { id: 10778, name: "null", transforms: [1124], transform: () => ({ id: 1124, name: "Bush" }) }
            : undefined),
    },
    playerEcs: { getIndexForServerId: () => 0, getLevel: () => 0 },
    controlledPlayerServerId: 1,
    widgetManager: {
        getWidgetByUid: (uid: number) => widgets.get(uid),
        getDynamicChildrenByParent: (w: any) => (w === widgets.get((715 << 16) | 9) ? [task] : []),
    },
};
const opened: string[] = [];
let searches = 0;
const chatbox: any = {
    openTextInput: (prompt: string) => {
        assert.equal(prompt, "OSRS Wiki Search");
        const input: any = { done: undefined as undefined | ((v: string) => void) };
        input.onDone = (fn: (v: string) => void) => { input.done = fn; return input; };
        input.build = () => { searches++; input.done("abyssal whip"); return input; };
        return input;
    },
};
const plugin = new WikiPlugin(client, chatbox);
plugin.browse = (url) => opened.push(url);
void plugin.start();

const selectWiki = () => {
    ClientState.isSpellSelected = true;
    ClientState.selectedSpellWidget = WIKI_ICONS[0];
    ClientState.selectedSpellSourceWidget = { uid: WIKI_ICONS[0] };
};
const click = (opcode: number, extra: Partial<{ param0: number; param1: number; itemId: number; option: string }> = {}) =>
    plugin.onMenuOptionClicked({ param0: 0, param1: 0, opcode, identifier: 0, itemId: -1, option: "", target: "",
        screenX: 0, screenY: 0, ...extra });

// --- World lookups, through the real menu: the scene's spell-target entries (as the world menu
// builds them while the button is selected), registered in a MenuState and invoked as a left
// click or a menu choice is. The click hook must look the target up itself: the entries' own
// handlers only run after the click hook, which consumes the click.
const pluginClicks = (action: MenuActionData) => plugin.onMenuOptionClicked(action);
const unconsumed: MenuActionData[] = [];
// After the plugin: sees only what it lets through, and keeps it from the network in this test.
const spy = (action: MenuActionData) => (unconsumed.push(action), true);
menuClickListeners.add(pluginClicks);
menuClickListeners.add(spy);
const spell = { spellId: 0, spellName: "<col=ff9040>Wiki</col>", spellLevel: 0, runes: null };
const state = new MenuState();
const invokeWorld = (entry: any): MenuActionData => {
    selectWiki();
    unconsumed.length = 0;
    const [simple] = worldEntriesToSimple([entry], { menuState: state, registerWithState: true });
    const index = simple.menuStateIndex!;
    const recorded = { opcode: state.opcodes[index], identifier: state.identifiers[index] } as MenuActionData;
    state.invoke(index, 0, 0);
    return recorded;
};
assert.equal(plugin.isWikiSelected(), false);
selectWiki();
assert.ok(plugin.isWikiSelected());
ClientState.baseX = 3168;
ClientState.baseY = 3168;

let row = invokeWorld({ option: "Lookup-entity", targetName: "<col=ff9040>Wiki</col> -> Man", targetType: MenuTargetType.NPC,
    targetId: 3106, npcServerId: 12, mapX: 43, mapY: 59, spellCast: { ...spell, npcServerId: 12 } });
assert.equal(row.opcode, 8, "WIDGET_TARGET_ON_NPC");
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=npc&id=3106&name=Man&x=3211&y=3227&plane=0");
assert.deepEqual(unconsumed, [], "consumed: no target op to the server");
assert.equal(ClientState.isSpellSelected, false, "a lookup ends the selection");

row = invokeWorld({ option: "Lookup-entity", targetName: "<col=ff9040>Wiki</col> -> Bush", targetType: MenuTargetType.LOC,
    targetId: 10778, mapX: 55, mapY: 49, spellCast: { ...spell, mapX: 55, mapY: 49 } });
assert.equal(row.opcode, 2, "WIDGET_TARGET_ON_GAME_OBJECT");
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=object&id=1124&name=Bush&x=3223&y=3217&plane=0",
    "the object's impostor, at its world tile (scene base + local)");
assert.deepEqual(unconsumed, []);

row = invokeWorld({ option: "Lookup-entity", targetName: "<col=ff9040>Wiki</col> -> Bronze axe", targetType: MenuTargetType.OBJ,
    targetId: 1352, mapX: 55, mapY: 50, spellCast: { ...spell, mapX: 55, mapY: 50 } });
assert.equal(row.opcode, 17, "WIDGET_TARGET_ON_GROUND_ITEM");
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=1351&name=Bronze+axe",
    "a noted ground item is looked up as its item");
assert.deepEqual(unconsumed, []);
assert.equal(opened.length, 0, "one page per click");

// Without the button selected the same row is the game's (the spy sees it).
ClientState.isSpellSelected = false;
const [walk] = worldEntriesToSimple([{ option: "Walk here", targetType: MenuTargetType.NONE, mapX: 55, mapY: 49 } as any],
    { menuState: state, registerWithState: true });
state.invoke(walk.menuStateIndex!, 0, 0);
assert.equal(unconsumed.length, 1, "not consumed");
assert.equal(opened.length, 0);
menuClickListeners.delete(spy);
menuClickListeners.delete(pluginClicks);

// --- Interface items: the selection's target op on an item ---------------------------------------
selectWiki();
assert.equal(click(25, { param1: 149 << 16, itemId: 1352 }), true, "consumed: nothing goes to the server");
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=1351&name=Bronze+axe");
selectWiki();
assert.equal(click(25, { param1: 149 << 16, itemId: 6512 }), true);
assert.equal(opened.length, 0, "a UI dummy item without a name opens nothing");
selectWiki();
assert.equal(click(25, { param1: WIKI_ICONS[0] }), false, "clicking the button again is the game's (deselect)");
assert.equal(click(8, { param0: 12 }), true, "any other target click while selected stays off the server");
ClientState.isSpellSelected = false;
assert.equal(click(25, { param1: 149 << 16, itemId: 1351 }), false, "nothing selected: not the wiki's");

// --- The button's Search op -----------------------------------------------------------------------
assert.equal(click(57, { param1: WIKI_ICONS[1], option: "Search" }), true);
assert.equal(searches, 1);
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/?search=abyssal+whip");
assert.equal(click(57, { param1: 123, option: "Search" }), false, "another widget's Search");

// --- Skill guides and combat achievement tasks get a Wiki option ---------------------------------
const stats = plugin.transformMenuEntries(
    [{ option: "View", target: "<col=ff981f>Strength</col> guide" }, { option: "Cancel" }],
    { surface: "widget", menu: true, widgetId: (320 << 16) | 2, childIndex: -1, itemId: -1 },
);
assert.deepEqual(stats.map((e) => e.option), ["Wiki", "View", "Cancel"], "above the widget's op, as RuneLite");
assert.equal(stats[0].target, "<col=ff981f>Strength</col>");
stats[0].onClick!();
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Strength");
const tasks = plugin.transformMenuEntries(
    [{ option: "Open", target: "" }, { option: "Cancel" }],
    { surface: "widget", menu: true, widgetId: (715 << 16) | 9, childIndex: 0, itemId: -1 },
);
assert.deepEqual(tasks.map((e) => e.option), ["Wiki", "Open", "Cancel"]);
tasks[0].onClick!();
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Noxious_Foe");
const other = [{ option: "Toggle", target: "" }, { option: "Cancel" }];
assert.equal(plugin.transformMenuEntries(other, { surface: "widget", menu: true, widgetId: (116 << 16) | 3, childIndex: -1, itemId: -1 }), other);

// --- Show wiki button: the game's button is hidden while it is off -------------------------------
const icon: any = { uid: WIKI_ICONS[0], hidden: false, isHidden: false };
widgets.set(WIKI_ICONS[0], icon);
client.widgetManager.invalidateWidgetRender = () => {};
client.widgetManager.invalidateWidget = () => {};
const config = inject(ConfigManager);
config.setConfigValue(WikiConfig, "showWikiMinimapButton", false);
plugin.onConfigChanged({ getGroup: () => "wiki" } as any);
assert.equal(icon.hidden, true);
config.setConfigValue(WikiConfig, "showWikiMinimapButton", true);
plugin.onConfigChanged({ getGroup: () => "wiki" } as any);
assert.equal(icon.hidden, false);

void plugin.stop();
selectWiki();
assert.equal(click(25, { param1: 149 << 16, itemId: 1351 }), false, "stopped: the game's again");
ClientState.isSpellSelected = false;

console.log("Wiki plugin tests passed");

{
    const calls: unknown[][] = [];
    const open = (...args: any[]) => { calls.push(args); };
    assert.equal(openClientUrl("https://oldschool.runescape.wiki/w/Special:Lookup?type=quest&id=16", true, open), true);
    assert.equal(openClientUrl("https://secure.runescape.com/", false, open), true);
    assert.equal(calls[0][1], "_blank");
    assert.equal(calls[1][1], "_self");
    assert.ok(calls.every(call => call[2] === "noopener,noreferrer"));
    for (const url of ["javascript:alert(1)", "data:text/html,test", "/relative", "invalid"]) assert.equal(openClientUrl(url, true, open), false);
    assert.equal(calls.length, 2, "invalid links never reach the browser");
}
