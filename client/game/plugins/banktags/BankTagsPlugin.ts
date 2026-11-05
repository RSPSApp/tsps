import { ConfigChanged } from "@runelite/api/events";
import { BANK } from "@runelite/api/gameval/InventoryID";
import { MESLAYERINPUT } from "@runelite/api/gameval/VarClientID";
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { getVariations } from "@runelite/client/game/ItemVariationMapping";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { Cs2Vm } from "../../../rs/cs2/Cs2Vm";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import type { OsrsClient } from "../../OsrsClient";
import { WidgetInteractionController } from "../../widgets/WidgetInteractionController";
import type { WidgetActionEvent } from "../../widgets/widgetActionPayload";
import type { ClientPlugin, ScriptCallbackEvent } from "../ClientPluginManager";
import { type BankTagsClient, osrsBankTagsClient } from "./bankClient";
import { Bankmain } from "./bankmain";
import { BankWidgets } from "./bankWidgets";
import { BankSearch } from "./BankSearch";
import { BankTagsConfig } from "./BankTagsConfig";
import {
    type BankTag,
    type BankTagsService,
    OPTION_ALLOW_MODIFICATIONS,
    OPTION_NO_LAYOUT,
} from "./BankTagsService";
import { fromCSV, toCSV } from "./bankTagText";
import { CONFIG_GROUP, ITEM_KEY_PREFIX, TagManager } from "./TagManager";
import type { Layout } from "./tabs/Layout";
import { LayoutManager, TAG_LAYOUT_PREFIX } from "./tabs/LayoutManager";
import { TAG_ICON_PREFIX, TAG_TABS_CONFIG, TabManager } from "./tabs/TabManager";
import { TabInterface, TAG_SEARCH, VAR_TAG_SUFFIX, charValidator } from "./tabs/TabInterface";
import { addTabSprites, removeTabSprites } from "./tabs/TabSprites";
import { examineSlot, isBankItemMenu, itemTarget } from "./bankMenus";

const EDIT_TAGS_MENU_OPTION = "Edit-tags";
const MAX_RESULT_COUNT = 250;
const SEARCH_BANK_INPUT_TEXT =
    "Show items whose names or tags contain the following text:<br>" + "(To show only tagged items, start your search with 'tag:')";
const searchBankInputTextFound = (n: number) =>
    `Show items whose names or tags contain the following text: (${n} found)<br>` +
    "(To show only tagged items, start your search with 'tag:')";

/** The config accessors Bank Tags reads, plus its two hidden setters. */
export type BankTagsConfigAccess = {
    tabs(): boolean;
    rememberTab(): boolean;
    removeSeparators(): boolean;
    preventTagTabDrags(): boolean;
    position(): number;
    tab(): string;
    setPosition(position: number): void;
    setTab(tab: string): void;
};

/**
 * RuneLite 1.13.3 Bank Tags. Tag bank items ("Edit-tags", or drag one onto a tab) and search
 * them with `tag:`; tag tabs down the bank's left side open a tag, and a tab can be laid out
 * freely. Other plugins use it through BankTagsService, TagManager and LayoutManager.
 *
 * RuneLite's patched bank scripts (rs/cs2/runelite/bankScripts.ts) supply the callbacks.
 */
export class BankTagsPlugin extends Plugin implements ClientPlugin, BankTagsService {
    static descriptor: PluginDescriptor = {
        name: "Bank Tags",
        description: "Enable tagging of bank items and searching of bank tags",
        tags: ["searching", "tagging"],
        configKey: "banktagsplugin",
    };

    static config = BankTagsConfig;

    private readonly configManager: ConfigManager;
    private readonly chatbox: ChatboxPanelManager;
    private readonly rawConfig: ConfigOf<typeof BankTagsConfig>;
    readonly config: BankTagsConfigAccess = {
        tabs: () => this.rawConfig.tabs(),
        rememberTab: () => this.rawConfig.rememberTab(),
        removeSeparators: () => this.rawConfig.removeSeparators(),
        preventTagTabDrags: () => this.rawConfig.preventTagTabDrags(),
        position: () => Number(this.rawConfig.position()) | 0,
        tab: () => String(this.rawConfig.tab() ?? ""),
        setPosition: (position) => this.configManager.setConfigValue(BankTagsConfig, "position", position),
        setTab: (tab) => this.configManager.setConfigValue(BankTagsConfig, "tab", tab),
    };

    readonly client: BankTagsClient;
    readonly widgets: BankWidgets;
    readonly tagManager: TagManager;
    readonly tabManager: TabManager;
    readonly layoutManager: LayoutManager;
    readonly tabInterface: TabInterface;
    private readonly bankSearch: BankSearch;

    private activeTag: string | null = null;
    private activeBankTag: BankTag | null = null;
    private activeLayout: Layout | null = null;
    private options = 0;
    private readonly unsubscribe: (() => void)[] = [];
    private listeningVm?: Cs2Vm;
    private readonly onScriptPre = (id: number) => this.handleScriptPre(id);
    private readonly onItemSearch = () => this.onGrandExchangeSearched();

    constructor(
        osrsClient?: OsrsClient,
        deps?: { client?: BankTagsClient; configManager?: ConfigManager; chatboxPanelManager?: ChatboxPanelManager },
    ) {
        super();
        this.configManager = deps?.configManager ?? inject(ConfigManager);
        this.chatbox = deps?.chatboxPanelManager ?? inject(ChatboxPanelManager);
        this.rawConfig = this.configManager.getConfig(BankTagsConfig);
        this.client = deps?.client ?? osrsBankTagsClient(osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN));
        this.widgets = new BankWidgets(() => this.client.widgets);
        this.tagManager = new TagManager(this.configManager, (id) => this.client.canonicalize(id));
        this.tabManager = new TabManager(this.configManager);
        this.bankSearch = new BankSearch(this.client);
        this.layoutManager = new LayoutManager(this.client, this.widgets, this, this.configManager, this.chatbox, this.bankSearch);
        this.tabInterface = new TabInterface(
            this.client,
            this.widgets,
            this,
            this.tagManager,
            this.tabManager,
            this.layoutManager,
            this.chatbox,
            this.config,
            this.bankSearch,
            {
                read: () => navigator.clipboard.readText(),
                write: (text) => navigator.clipboard.writeText(text),
            },
        );
    }

    protected override async startUp(): Promise<void> {
        this.cleanConfig();
        addTabSprites();
        this.listenForScripts();
        const drag = (event: { released: boolean }) => this.guard("drag", () => this.tabInterface.onWidgetDrag(event.released));
        WidgetInteractionController.dragListeners.add(drag);
        this.unsubscribe.push(() => WidgetInteractionController.dragListeners.delete(drag));
        const closed = (groupId: number, _modal: number, unload: boolean) => {
            if (groupId === 12 && unload) this.tabInterface.onBankClosed();
        };
        this.client.widgets?.interfaceClosedListeners?.add(closed);
        this.unsubscribe.push(() => this.client.widgets?.interfaceClosedListeners?.delete(closed));
        this.reinitBank();
    }

    protected override async shutDown(): Promise<void> {
        for (const off of this.unsubscribe.splice(0)) off();
        this.listeningVm?.scriptPreListeners.delete(this.onScriptPre);
        this.listeningVm?.itemSearchListeners.delete(this.onItemSearch);
        this.listeningVm = undefined;
        // The tab interface no longer gets events, so take it down, then build the bank again.
        this.tabInterface.deinit();
        this.reinitBank();
        removeTabSprites();
    }

    /** RuneLite's resetConfiguration: also clears the tags, icons, tabs and layouts. */
    resetConfiguration(): void {
        for (const prefix of [ITEM_KEY_PREFIX, TAG_ICON_PREFIX, TAG_TABS_CONFIG, TAG_LAYOUT_PREFIX]) {
            for (const key of this.configManager.getConfigurationKeys(`${CONFIG_GROUP}.${prefix}`)) {
                this.configManager.unsetConfiguration(CONFIG_GROUP, key.slice(CONFIG_GROUP.length + 1));
            }
        }
        this.reinitBank();
    }

    /** The client builds its VM after plugins start, and may build another: follow it. */
    private listenForScripts(): void {
        const vm = this.client.vm;
        if (!vm || vm === this.listeningVm) return;
        this.listeningVm?.scriptPreListeners.delete(this.onScriptPre);
        this.listeningVm?.itemSearchListeners.delete(this.onItemSearch);
        vm.scriptPreListeners.add(this.onScriptPre);
        vm.itemSearchListeners.add(this.onItemSearch);
        this.listeningVm = vm;
    }

    onClientTick(): void {
        if (this.isStarted()) this.listenForScripts();
    }

    /** Calls [clientscript,bankmain_init]. */
    private reinitBank(): void {
        const w = this.client.getWidget(Bankmain.UNIVERSE);
        if (w) this.client.runListener(w, "onLoad");
    }

    /** Old releases allowed <, >, : and / in tag names. */
    private cleanConfig(): void {
        this.removeInvalidTags(TAG_TABS_CONFIG);
        for (const key of this.configManager.getConfigurationKeys(`${CONFIG_GROUP}.${ITEM_KEY_PREFIX}`)) {
            this.removeInvalidTags(key.slice(CONFIG_GROUP.length + 1));
        }
        for (const full of this.configManager.getConfigurationKeys(`${CONFIG_GROUP}.${TAG_ICON_PREFIX}`)) {
            const key = full.slice(CONFIG_GROUP.length + 1);
            const replaced = key.replace(/[<>/]/g, "");
            if (key === replaced) continue;
            const value = this.configManager.getConfiguration(CONFIG_GROUP, key);
            this.configManager.unsetConfiguration(CONFIG_GROUP, key);
            if (replaced.length > TAG_ICON_PREFIX.length && value !== undefined) this.configManager.setConfiguration(CONFIG_GROUP, replaced, value);
        }
    }

    private removeInvalidTags(key: string): void {
        const value = this.configManager.getConfiguration(CONFIG_GROUP, key);
        if (value === undefined) return;
        let replaced = value.replace(/[<>:/]/g, "");
        if (value === replaced) return;
        replaced = toCSV(fromCSV(replaced));
        if (!replaced) this.configManager.unsetConfiguration(CONFIG_GROUP, key);
        else this.configManager.setConfiguration(CONFIG_GROUP, key, replaced);
    }

    // ------------------------------------------------------------------ events

    private handleScriptPre(scriptId: number): void {
        if (!this.isStarted()) return;
        this.guard(`script ${scriptId}`, () => {
            this.tabInterface.onScriptPreFired(scriptId);
            this.layoutManager.onScriptPreFired(scriptId);
        });
    }

    onScriptFinished(scriptId: number): void {
        if (this.isStarted()) this.guard(`script ${scriptId}`, () => this.tabInterface.onScriptPostFired(scriptId));
    }

    /** GrandExchangeSearched: a `tag:` search lists the tag's tradeable items. */
    private onGrandExchangeSearched(): boolean {
        const vm = this.listeningVm;
        if (!this.isStarted() || !vm) return false;
        const input = this.client.getVarcStrValue(MESLAYERINPUT);
        if (!input.startsWith(TAG_SEARCH)) return false;

        const tag = input.substring(TAG_SEARCH.length).trim();
        const ids = new Set<number>();
        for (const item of this.tagManager.getItemsForTag(tag)) {
            for (const id of getVariations(Math.abs(item))) {
                if (this.client.getItemDefinition(id)?.isTradable) ids.add(id);
            }
        }
        const sorted = [...ids].sort((a, b) => a - b).slice(0, MAX_RESULT_COUNT);
        vm.itemSearchIndex = 0;
        vm.itemSearchCount = sorted.length;
        vm.itemSearchResults = sorted;
        return true;
    }

    onScriptCallback(event: ScriptCallbackEvent): void {
        if (this.isStarted()) this.guard(event.eventName, () => this.scriptCallback(event));
    }

    private scriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        const intStack = vm.intStack;
        const intStackSize = vm.intStackSize;
        const objectStack = vm.stringStack;
        const objectStackSize = vm.stringStackSize;

        switch (eventName) {
            case "setSearchBankInputText":
                objectStack[objectStackSize - 1] = SEARCH_BANK_INPUT_TEXT;
                break;
            case "setSearchBankInputTextFound":
                objectStack[objectStackSize - 1] = searchBankInputTextFound(intStack[intStackSize - 1]);
                break;
            case "bankSearchFilter": {
                const itemId = intStack[intStackSize - 1];
                let searchfilter = String(objectStack[objectStackSize - 1] ?? "");

                let tag = this.activeBankTag;
                let tagSearch = true;
                // Shared storage uses ~bankmain_filteritem too: tag searches work there, but not
                // the active tab's tag.
                const bankOpen = this.client.getItemContainer(BANK) !== undefined;
                if (tag === null || !bankOpen) {
                    if (!searchfilter) return;
                    tagSearch = searchfilter.startsWith(TAG_SEARCH);
                    if (tagSearch) searchfilter = searchfilter.substring(TAG_SEARCH.length).trim();
                    tag = this.buildSearchFilterBankTag(searchfilter);
                }

                // Item -1 always passes on a laid-out tab, so items can be dragged to it.
                if (itemId === -1 && this.activeLayout !== null) return;

                if (itemId > -1 && tag.contains(itemId)) {
                    intStack[intStackSize - 2] = 1;
                } else if (tagSearch) {
                    // Untagged: no match, even if the name contains the tag.
                    intStack[intStackSize - 2] = 0;
                }
                break;
            }
            case "getSearchingTagTab":
                // The script pushes 0; only set it, so another plugin's tab (Quest Helper's) can too.
                if (this.activeBankTag !== null) intStack[intStackSize - 1] = 1;
                break;
            case "bankBuildTab":
                // The single-tab view hides the separators without repositioning the items.
                if (
                    this.activeBankTag !== null &&
                    (this.tabInterface.isTagTabActive() || this.config.removeSeparators() || this.activeLayout !== null)
                ) {
                    intStack[intStackSize - 1] = 1;
                }
                break;
        }
    }

    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted() || context.surface !== "widget" || !context.menu || context.widgetId >>> 16 !== 12) return entries;
        const widget = this.client.widgets?.getWidgetByUid?.(context.widgetId);
        const ctx = {
            componentId: widget ? this.widgets.id(widget) : context.widgetId,
            childIndex: context.childIndex,
            itemId: context.itemId,
            widget,
        };
        let out = entries;
        if (ctx.componentId === Bankmain.ITEMS && ctx.itemId > 0) out = this.addEditTags(out, ctx.itemId);
        return this.tabInterface.addMenuEntries(out, ctx);
    }

    /** "Edit-tags (n)" just above Examine on a bank item. */
    private addEditTags(entries: SimpleMenuEntry[], itemId: number): SimpleMenuEntry[] {
        if (!isBankItemMenu(entries)) return entries;
        const examine = examineSlot(entries);
        const tags = this.tagManager.getTags(itemId, false);
        for (const tag of this.tagManager.getTags(itemId, true)) tags.add(tag);
        const tagCount = [...tags].filter((tag) => !this.tagManager.isHidden(tag)).length;
        const text = tagCount > 0 ? `${EDIT_TAGS_MENU_OPTION} (${tagCount})` : EDIT_TAGS_MENU_OPTION;
        const out = [...entries];
        out.splice(examine, 0, { option: text, target: itemTarget(entries), onClick: () => this.editTags(itemId) });
        return out;
    }

    private editTags(itemId: number): void {
        const name = this.client.getItemDefinition(itemId)?.name ?? "";
        // Tags, then variation tags with a * after them.
        const tags = [...this.tagManager.getTags(itemId, false)].filter((t) => !this.tagManager.isHidden(t));
        for (const t of this.tagManager.getTags(itemId, true)) if (!this.tagManager.isHidden(t)) tags.push(t + VAR_TAG_SUFFIX);

        this.chatbox
            .openTextInput(`${name} tags:<br>(append ${VAR_TAG_SUFFIX} for variation tag)`)
            .addCharValidator(charValidator)
            .value(toCSV(tags))
            .onDone((newValue: string) => {
                // Tags ending in * are variation tags.
                const newTags = fromCSV(newValue.toLowerCase());
                const newVarTags = newTags.filter((s) => s.endsWith(VAR_TAG_SUFFIX)).map((s) => s.slice(0, -VAR_TAG_SUFFIX.length));
                this.tagManager.setTagString(itemId, toCSV(newTags.filter((s) => !s.endsWith(VAR_TAG_SUFFIX))), false);
                this.tagManager.setTagString(itemId, toCSV(newVarTags), true);
                // Rebuild an open tab to show the change.
                this.tabInterface.reloadActiveTab();
            })
            .build();
    }

    handleWidgetAction(event: WidgetActionEvent): boolean {
        if (!this.isStarted()) return false;
        return this.guard("menu click", () => this.tabInterface.onMenuOptionClicked(event)) ?? false;
    }

    /** Runs a hook; a failure is logged and never reaches the bank's scripts or the client. */
    private guard<T>(what: string, fn: () => T): T | undefined {
        try {
            return fn();
        } catch (error) {
            console.warn(`[banktags] ${what} failed`, error);
            return undefined;
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === CONFIG_GROUP && event.getKey() === "useTabs") this.reinitBank();
    }

    // ------------------------------------------------------------------ BankTagsService

    getActiveTag(): string | null {
        return this.activeTag;
    }

    getActiveBankTag(): BankTag | null {
        return this.activeBankTag;
    }

    getActiveLayout(): Layout | null {
        return this.activeLayout;
    }

    getOptions(): number {
        return this.options;
    }

    openTag(tag: string | null, layout: Layout | null, options: number = OPTION_ALLOW_MODIFICATIONS): void {
        if (tag === null) {
            this.activeTag = null;
            this.activeBankTag = null;
            this.activeLayout = null;
            this.options = 0;
            return;
        }
        this.activeTag = tag;
        this.activeBankTag = this.buildSearchFilterBankTag(tag);
        this.activeLayout = layout;
        this.options = options;
        this.tabInterface.openTag(tag, layout, options, true);
    }

    /** A tag's items, and a plugin's custom tag of that name. */
    private buildSearchFilterBankTag(tag: string): BankTag {
        const custom = this.tagManager.findCustomTag(tag);
        return { contains: (itemId) => this.tagManager.findTag(itemId, tag) || (custom?.contains(itemId) ?? false) };
    }

    openBankTag(name: string, options: number = OPTION_ALLOW_MODIFICATIONS): void {
        const layout = (options & OPTION_NO_LAYOUT) !== 0 ? null : this.layoutManager.loadLayout(name);
        this.openTag(name, layout, options);
    }

    closeBankTag(): void {
        this.tabInterface.closeTag(false);
        this.activeTag = null;
        this.activeBankTag = null;
        this.activeLayout = null;
        this.options = 0;
        this.bankSearch.layoutBank();
    }

    /** For other plugins: the widget of a bank component, as RuneLite's client.getWidget. */
    getWidget(componentId: number): WidgetNode | undefined {
        return this.client.getWidget(componentId);
    }
}
