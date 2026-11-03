import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientState } from "../game/ClientState";
import { WikiConfig } from "../game/plugins/wiki/WikiConfig";
import { lookupUrl, pageUrl, searchUrl, WIKI_ICONS, WikiPlugin } from "../game/plugins/wiki/WikiPlugin";
import { MenuTargetType } from "../rs/MenuEntry";

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

// --- World lookups: the target entries open the wiki and clear the selection ----------------------
assert.equal(plugin.isWikiSelected(), false);
selectWiki();
assert.ok(plugin.isWikiSelected());
ClientState.baseX = 3168;
ClientState.baseY = 3168;
const world = plugin.transformMenuEntries([
    { option: "Lookup-entity", target: "Wiki -> Man", targetType: MenuTargetType.NPC, targetId: 3106, npcServerId: 12 },
    { option: "Lookup-entity", target: "Wiki -> Bush", targetType: MenuTargetType.LOC, targetId: 10778, mapX: 55, mapY: 49 },
    { option: "Lookup-entity", target: "Wiki -> Bronze axe", targetType: MenuTargetType.OBJ, targetId: 1352 },
    { option: "Cancel" },
], { surface: "world", menu: true });
assert.equal(world.length, 4);
world[0].onClick!();
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=npc&id=3106&name=Man&x=3211&y=3227&plane=0");
assert.equal(ClientState.isSpellSelected, false, "a lookup ends the selection");
selectWiki();
world[1].onClick!();
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=object&id=1124&name=Bush&x=3223&y=3217&plane=0",
    "the object's impostor, at its world tile (scene base + local)");
selectWiki();
world[2].onClick!();
assert.equal(opened.pop(), "https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=1351&name=Bronze+axe",
    "a noted ground item is looked up as its item");
assert.equal(world[3].onClick, undefined, "Cancel is left alone");

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
