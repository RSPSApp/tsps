import { CA_TASKS, STATS } from "@runelite/api/gameval/InterfaceID";
import type { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { MenuTargetType } from "../../../rs/MenuEntry";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuActionData } from "../../../ui/menu/menuEvents";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import { CANCEL_SELECTION_HANDLER } from "../../../widgets/gl/widgetsGl/constants";
import { setHidden } from "../../../widgets/custom/dynamicWidgets";
import { ClientState } from "../../ClientState";
import type { OsrsClient } from "../../OsrsClient";
import { canonicalItemId } from "../inventorytags/inventoryTags";
import { removeTags } from "../banktags/bankTagText";
import { WikiConfig } from "./WikiConfig";

export const WIKI_BASE = "https://oldschool.runescape.wiki";
const MENUOP_WIKI = "Wiki";
/** InterfaceID.Orbs.WIKI_ICON and InterfaceID.OrbsNomap.WIKI_ICON: the game's wiki button. */
export const WIKI_ICONS = [(160 << 16) | 52, (895 << 16) | 56];
/** ScriptID.WIKI_ICON_UPDATE: positions the wiki button and shows or hides it. */
const WIKI_ICON_UPDATE = 3306;
/** InterfaceID.Stats.UNIVERSE and InterfaceID.CaTasks.TASKS_BACKGROUND. */
const STATS_UNIVERSE = (STATS << 16) | 0;
const CA_TASKS_BACKGROUND = (CA_TASKS << 16) | 9;

/** A Special:Lookup request (WikiPlugin.onMenuOptionClicked's url). */
export type WikiLookup = {
    type: "item" | "npc" | "object";
    id: number;
    name: string;
    location?: { x: number; y: number; plane: number };
};

/** The Special:Lookup page for a thing the wiki button was used on. */
export function lookupUrl(lookup: WikiLookup): string {
    const url = new URL("/w/Special:Lookup", WIKI_BASE);
    url.searchParams.set("type", lookup.type);
    url.searchParams.set("id", String(lookup.id));
    url.searchParams.set("name", lookup.name);
    if (lookup.location) {
        url.searchParams.set("x", String(lookup.location.x));
        url.searchParams.set("y", String(lookup.location.y));
        url.searchParams.set("plane", String(lookup.location.plane));
    }
    return url.toString();
}

/** A wiki page by title (the skill guide and combat achievement entries). */
export function pageUrl(title: string): string {
    return new URL(`/w/${encodeURIComponent(removeTags(title).replace(/ /g, "_"))}`, WIKI_BASE).toString();
}

/** A wiki search for the text (the button's Search). */
export function searchUrl(text: string): string {
    const url = new URL("/", WIKI_BASE);
    url.searchParams.set("search", text);
    return url.toString();
}

/** MenuAction ids a selected component's target clicks use (RuneLite's WIDGET_TARGET_ON_*). */
const WIDGET_TARGET_ON_GAME_OBJECT = 2;
const WIDGET_TARGET_ON_NPC = 8;
const WIDGET_TARGET_ON_PLAYER = 15;
const WIDGET_TARGET_ON_GROUND_ITEM = 17;
const WIDGET_TARGET_ON_WIDGET = 58;
const WIDGET_TARGET = 25;
const TARGET_OPCODES = new Set([WIDGET_TARGET_ON_GAME_OBJECT, WIDGET_TARGET_ON_NPC, WIDGET_TARGET_ON_PLAYER,
    WIDGET_TARGET_ON_GROUND_ITEM, WIDGET_TARGET_ON_WIDGET]);
const CC_OP = 57;
const CC_OP_LOW_PRIORITY = 1007;

/**
 * RuneLite 1.13.5 Wiki: the wiki button under the minimap looks up what it is used on (an NPC,
 * object, ground item or item) on the OSRS Wiki, and skills and combat achievement tasks get a
 * "Wiki" option. The button is the game's own: RuneLite replaces it with its own widget, which
 * this client doesn't need, as the lookup is handled where the target is clicked.
 */
export class WikiPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Wiki",
        description: "Adds a Wiki button that takes you to the OSRS Wiki",
        configKey: "wikiplugin",
    };

    static config = WikiConfig;

    readonly config = inject(ConfigManager).getConfig(WikiConfig);
    private readonly client: OsrsClient;
    private readonly chatbox?: ChatboxPanelManager;
    /** LinkBrowser.browse. */
    browse: (url: string) => void = (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
    };

    constructor(client?: OsrsClient, chatbox?: ChatboxPanelManager) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.chatbox = chatbox ?? (client ? undefined : inject(ChatboxPanelManager));
    }

    protected async startUp(): Promise<void> {
        this.updateButton();
    }

    protected async shutDown(): Promise<void> {
        this.updateButton();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === WikiConfig.group) this.updateButton();
    }

    onScriptFinished(scriptId: number): void {
        if (scriptId === WIKI_ICON_UPDATE) this.updateButton();
    }

    /** Hides the game's button when "Show wiki button under minimap" is off. */
    private updateButton(): void {
        const manager = this.client.widgetManager;
        if (!manager) return;
        const hide = this.isStarted() && this.config.showWikiMinimapButton() !== true;
        for (const uid of WIKI_ICONS) {
            const widget: any = manager.getWidgetByUid(uid);
            if (!widget) continue;
            if (hide && !widget.hidden) {
                widget.__wikiHidden = true;
                setHidden(manager, widget, true);
            } else if (!hide && widget.__wikiHidden) {
                // Back to what the game's script last left it.
                widget.__wikiHidden = false;
                setHidden(manager, widget, false);
            }
        }
    }

    /** The wiki button is selected (its "Lookup" target cursor is up). */
    isWikiSelected(): boolean {
        if (!ClientState.isSpellSelected) return false;
        const source = ClientState.selectedSpellSourceWidget;
        const uid = typeof source?.uid === "number" ? source.uid : ClientState.selectedSpellWidget;
        return WIKI_ICONS.includes(uid);
    }

    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted()) return entries;
        if (this.isWikiSelected()) return context.surface === "world" ? this.lookupEntries(entries) : entries;
        if (context.surface === "widget" && context.menu) return this.widgetWikiEntries(entries, context);
        return entries;
    }

    /**
     * The button's target entries on the world, made to open the wiki instead of going to the
     * server. (An interface item's target entry is the selection's own; onMenuOptionClicked takes
     * its click.)
     */
    private lookupEntries(entries: SimpleMenuEntry[]): SimpleMenuEntry[] {
        return entries.map((entry) => {
            const lookup = this.lookupFor(entry);
            if (lookup === undefined) return entry;
            return {
                ...entry,
                onClick: () => {
                    CANCEL_SELECTION_HANDLER();
                    if (lookup) this.browse(lookupUrl(lookup));
                },
            };
        });
    }

    /** What a world entry looks up; undefined for entries that aren't a lookup, null for nothing. */
    private lookupFor(entry: SimpleMenuEntry): WikiLookup | null | undefined {
        const option = String(entry.option ?? "").trim().toLowerCase();
        if (option === "cancel" || option === "examine" || option === "walk here") return undefined;
        switch (entry.targetType) {
            case MenuTargetType.NPC:
                return this.npcLookup(entry);
            case MenuTargetType.LOC:
                return this.locLookup(entry);
            case MenuTargetType.OBJ:
                return this.itemLookup(entry.targetId ?? -1);
            default:
                return undefined;
        }
    }

    private itemLookup(itemId: number): WikiLookup | null {
        const loader = this.client.objTypeLoader;
        const id = canonicalItemId(itemId, (i) => loader?.load(i) as any);
        const name = loader?.load(id)?.name;
        // may be a dummy item for the UI without a name
        if (!name || name === "null") return null;
        return { type: "item", id, name: removeTags(name) };
    }

    private npcLookup(entry: SimpleMenuEntry): WikiLookup | null {
        const client = this.client;
        const ecsId = entry.npcServerId !== undefined ? client.npcEcs?.getEcsIdForServer(entry.npcServerId) : undefined;
        let type = ecsId !== undefined ? client.npcTypeLoader?.load(client.npcEcs.getNpcTypeId(ecsId) | 0) : undefined;
        if (type?.transforms) type = type.transform(client.varManager, client.npcTypeLoader) ?? type;
        if (!type) return null;
        const location = ecsId !== undefined ? this.npcLocation(ecsId) : undefined;
        return { type: "npc", id: type.id, name: removeTags(type.name), location };
    }

    private npcLocation(ecsId: number): WikiLookup["location"] {
        // World fine coordinates: the NPC's map square plus its position in it, 128 per tile.
        const npcs = this.client.npcEcs;
        if (!npcs) return undefined;
        return { x: npcs.getWorldX(ecsId) >> 7, y: npcs.getWorldY(ecsId) >> 7, plane: this.plane() };
    }

    private locLookup(entry: SimpleMenuEntry): WikiLookup | null {
        const client = this.client;
        let type = client.locTypeLoader?.load(entry.targetId ?? -1);
        if (type?.transforms) type = type.transform(client.varManager, client.locTypeLoader) ?? type;
        if (!type) return null;
        const location = entry.mapX !== undefined && entry.mapY !== undefined
            ? { x: ClientState.baseX + entry.mapX, y: ClientState.baseY + entry.mapY, plane: this.plane() }
            : undefined;
        return { type: "object", id: type.id, name: removeTags(type.name), location };
    }

    private plane(): number {
        const players: any = this.client.playerEcs;
        const index = players?.getIndexForServerId?.(this.client.controlledPlayerServerId);
        return index === undefined || index < 0 ? 0 : (players.getLevel(index) | 0);
    }

    /** RuneLite's onMenuEntryAdded for the skill guides and combat achievement tasks: a Wiki option. */
    private widgetWikiEntries(entries: SimpleMenuEntry[], context: Extract<MenuTransformContext, { surface: "widget" }>): SimpleMenuEntry[] {
        const group = context.widgetId >>> 16;
        if (group !== STATS && group !== CA_TASKS) return entries;
        const widget = this.widget(context.widgetId, context.childIndex);
        if (!widget) return entries;
        let target: string | undefined;
        if (group === STATS) {
            if (!Array.isArray(widget.actions) || this.parentUid(widget) !== STATS_UNIVERSE) return entries;
            const action = (widget.actions as (string | null)[]).find((s) => s);
            if (!action) return entries;
            target = action.replace("View ", "").replace(" guide", "");
        } else {
            if (!Array.isArray(widget.actions) || this.parentUid(widget) !== CA_TASKS_BACKGROUND) return entries;
            target = String(widget.name ?? widget.opBase ?? "");
        }
        if (!target) return entries;
        const wiki: SimpleMenuEntry = {
            option: MENUOP_WIKI,
            target,
            onClick: () => this.browse(pageUrl(target!)),
        };
        // Added as the widget's first op is: just above its lowest entry before Cancel.
        const cancel = entries.findIndex((e) => String(e.option).toLowerCase() === "cancel");
        const at = cancel === -1 ? entries.length : cancel;
        return [...entries.slice(0, Math.max(0, at - 1)), wiki, ...entries.slice(Math.max(0, at - 1))];
    }

    private widget(widgetId: number, childIndex: number): any {
        const manager: any = this.client.widgetManager;
        const widget = manager?.getWidgetByUid(widgetId);
        if (childIndex === -1 || !widget) return widget;
        return manager.getDynamicChildrenByParent?.(widget)?.[childIndex] ?? widget.children?.[childIndex];
    }

    private parentUid(widget: any): number {
        return typeof widget.parentUid === "number" ? widget.parentUid : (widget.parentId ?? -1);
    }

    /**
     * RuneLite's onMenuOptionClicked. While the button is selected every target click is the
     * plugin's: an item in an interface is looked up, and nothing goes to the server (the world's
     * NPCs, objects and ground items are looked up by the entries lookupEntries made). The
     * button's own Search op opens the search input.
     */
    onMenuOptionClicked(action: MenuActionData): boolean {
        if (!this.isStarted()) return false;
        // A selection used on an interface item comes as the target op (25) on the item's widget
        // here; the button's own target op is a re-click that deselects it.
        const itemTarget = action.opcode === WIDGET_TARGET && action.itemId > 0 && !WIKI_ICONS.includes(action.param1);
        if (this.isWikiSelected() && (TARGET_OPCODES.has(action.opcode) || itemTarget)) {
            CANCEL_SELECTION_HANDLER();
            if ((action.opcode === WIDGET_TARGET_ON_WIDGET || itemTarget) && action.itemId > 0) {
                const lookup = this.itemLookup(action.itemId);
                if (lookup) this.browse(lookupUrl(lookup));
            }
            return true;
        }
        if ((action.opcode === CC_OP || action.opcode === CC_OP_LOW_PRIORITY) && WIKI_ICONS.includes(action.param1)
            && removeTags(action.option) === "Search") {
            this.openSearchInput();
            return true;
        }
        return false;
    }

    /** WikiSearchChatboxTextInput, without its search suggestions: the wiki's search for the text. */
    openSearchInput(): void {
        this.chatbox
            ?.openTextInput("OSRS Wiki Search")
            .onDone((value: string) => {
                if (value && value.length > 0) this.browse(searchUrl(value));
            })
            .build();
    }
}
