import type { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { ChatboxItemSearch } from "@runelite/client/game/chatbox/ChatboxItemSearch";
import { BANK, INV, WORN } from "@runelite/api/gameval/InventoryID";
import { BANK_CURRENTTAB, BANK_INSERTMODE } from "@runelite/api/gameval/VarbitID";
import { WidgetType } from "../../../../widgets/custom/dynamicWidgets";
import type { WidgetNode } from "../../../../widgets/WidgetNode";
import type { SimpleMenuEntry } from "../../../../ui/menu/MenuEngine";
import type { WidgetActionEvent } from "../../../widgets/widgetActionPayload";
import type { BankTagsClient } from "../bankClient";
import {
    BANK_ITEM_HEIGHT,
    BANK_ITEM_START_X,
    BANK_ITEM_START_Y,
    BANK_ITEM_WIDTH,
    BANK_ITEM_X_PADDING,
    BANK_ITEM_Y_PADDING,
    BANK_ITEMS_PER_ROW,
    Bankmain,
    ITEM_SPRITE_HEIGHT,
    ITEM_SPRITE_WIDTH,
    SOUND_UI_BOOP,
    ScriptID,
} from "../bankmain";
import { BankWidgets, ItemQuantityMode, WIDGET_DRAG, WIDGET_DRAG_ON } from "../bankWidgets";
import type { BankSearch } from "../BankSearch";
import type { BankTagsConfigAccess } from "../BankTagsPlugin";
import { OPTION_ALLOW_MODIFICATIONS, OPTION_HIDE_TAG_NAME } from "../BankTagsService";
import {
    MENU_TARGET_COLOR,
    fromCSV,
    isAllowedTagChar,
    removeTags,
    standardize,
    toCSV,
    wrapWithColorTag,
} from "../bankTagText";
import type { TagManager } from "../TagManager";
import { Layout } from "./Layout";
import type { LayoutManager } from "./LayoutManager";
import type { TabManager } from "./TabManager";
import { TagTab } from "./TabManager";
import { TabSprites } from "./TabSprites";
import { examineSlot, isBankItemMenu, itemTarget } from "../bankMenus";

export const TAG_SEARCH = "tag:";
export const VAR_TAG_SUFFIX = "*";

const SCROLL_UP = "Scroll up";
const SCROLL_DOWN = "Scroll down";
const NEW_TAB = "New tag tab";
const REMOVE_TAB = "Delete tag tab";
const EXPORT_TAB = "Export tag tab";
const IMPORT_TAB = "Import tag tab";
const VIEW_TAB = "View tag tab";
const RENAME_TAB = "Rename tag tab";
const CHANGE_ICON = "Change icon";
const REMOVE_TAG = "Remove-tag";
const TAG_GEAR = "Tag-equipment";
const TAG_INVENTORY = "Tag-inventory";
export const TAGTABS = "tagtabs";
const OPEN_TAB_MENU = "View tag tabs";
export const ENABLE_LAYOUT = "Enable layout";
export const DISABLE_LAYOUT = "Disable layout";
export const REMOVE_LAYOUT = "Remove-layout";
export const DUPLICATE_ITEM = "Duplicate-item";
const TAB_HEIGHT = 40;
const TAB_WIDTH = 39;
const BUTTON_HEIGHT = 20;
const MARGIN = 1;
const SCROLL_TICK = 500;
/** Offset from the bottom of the bank's item container. */
const BANK_BOTTOM_OFFSET = 39;
const TAB_OP_OPEN_TAG = 1;
const TAB_OP_CHANGE_ICON = 2;
const TAB_OP_LAYOUT = 3;
const TAB_OP_EXPORT_TAB = 4;
const TAB_OP_RENAME_TAB = 5;
const TAB_OP_DELETE_TAB = 6;
const NEWTAB_OP_NEW_TAB = 1;
const NEWTAB_OP_IMPORT_TAB = 2;
const NEWTAB_OP_OPEN_TAB_MENU = 3;
const TAGTAB_CHILD_OFFSET = 4;

/** What TabInterface calls back into on the plugin (RuneLite's BankTagsPlugin). */
export interface TabInterfacePlugin {
    openTag(tag: string | null, layout: Layout | null, options?: number): void;
    openBankTag(tag: string): void;
}

/** A menu entry Bank Tags adds, with what RuneLite's MenuEntryAdded gives it. */
export type BankMenuContext = {
    /** The component (a dynamic child's parent) and the child's index: actionParam1 and actionParam0. */
    componentId: number;
    childIndex: number;
    itemId: number;
    widget?: WidgetNode;
};

/**
 * RuneLite's TabInterface: the tag tabs down the left of the bank, the up/down and new-tab
 * buttons, the "tag tab tab" that lists every tab as an item, and the bank menu options that go
 * with them.
 */
export class TabInterface {
    private enabled = false;
    activeTag: string | null = null;
    private activeLayout: Layout | null = null;
    private activeOptions = 0;
    tagTabActive = false;
    private tagTabFirstChildIdx = -1;
    private tabScrollOffset = 0;
    private startScroll = 0;
    private tabCount = 0;

    private parent?: WidgetNode;
    private scrollComponent?: WidgetNode;
    private upButton?: WidgetNode;
    private downButton?: WidgetNode;
    private newTab?: WidgetNode;

    constructor(
        private readonly client: BankTagsClient,
        private readonly widgets: BankWidgets,
        private readonly plugin: TabInterfacePlugin,
        private readonly tagManager: TagManager,
        private readonly tabManager: TabManager,
        private readonly layoutManager: LayoutManager,
        private readonly chatbox: ChatboxPanelManager,
        private readonly config: BankTagsConfigAccess,
        private readonly bankSearch: BankSearch,
        private readonly clipboard: { read(): Promise<string>; write(text: string): Promise<void> },
        private readonly now: () => number = () => Date.now(),
    ) {}

    isTagTabActive(): boolean {
        return this.tagTabActive;
    }

    getActiveTag(): string | null {
        return this.activeTag;
    }

    // ------------------------------------------------------------------ script hooks

    onScriptPreFired(scriptId: number): void {
        const vm = this.client.vm;
        if (scriptId === ScriptID.BANKMAIN_INIT) {
            const tabs = this.config.tabs();
            if (this.enabled !== tabs) {
                this.enabled = tabs;
                // Off: probably "Use tag tabs" being toggled with the bank open.
                if (tabs) this.init();
                else this.deinit();
            }
        } else if (scriptId === ScriptID.BANKMAIN_SIZE_CHECK && this.enabled && vm) {
            // [proc,bankmain_size_check]: resize the tab layer when the bank is resized.
            const size = vm.intStackSize;
            const w = this.client.getWidget(vm.intStack[size - 5]);
            const width = vm.intStack[size - 4];
            const height = vm.intStack[size - 3];
            if (w && (w.width !== width || w.height !== height)) {
                // Right before the bank is resized, so lay out after it is.
                queueMicrotask(() => {
                    if (!this.parent) return;
                    this.repositionButtons();
                    this.layoutTabs();
                });
            }
        } else if (scriptId === ScriptID.BANKMAIN_SEARCH_TOGGLE) {
            // Close the active tab when search is pressed.
            if (this.activeTag !== null || this.tagTabActive) this.closeTag(false);
        } else if (scriptId === ScriptID.BANKMAIN_FINISHBUILDING && this.enabled && this.parent) {
            if (this.tagTabActive) this.hideBank();

            this.repositionButtons();
            this.rebuildTabs();
            const tagTabHeight = this.rebuildTagTabTab();

            const bankTitle = this.client.getWidget(Bankmain.TITLE);
            if (bankTitle) {
                // The tag tab tab has its own title, since it isn't a real tag.
                if (this.tagTabActive) this.widgets.setText(bankTitle, "Tag tab tab");
                else if (this.activeTag !== null) this.widgets.setText(bankTitle, `Tag tab <col=ff0000>${this.activeTag}</col>`);
            }

            // The tag tab tab shows no real items, so its scroll height is computed here: the
            // arguments are still on the stack, and int13 (9 from the end) is if_setscrollsize's.
            if (this.tagTabActive && vm) vm.intStack[vm.intStackSize - 9] = tagTabHeight;
        }
    }

    onScriptPostFired(scriptId: number): void {
        if (scriptId === ScriptID.BANKMAIN_POPUP_TAB_DRAW && this.parent) {
            this.repositionButtons();
            this.layoutTabs();
        }
    }

    /** WidgetClosed for the bank, unloading. */
    onBankClosed(): void {
        this.enabled = false;
        this.upButton = this.downButton = this.newTab = this.scrollComponent = this.parent = undefined;
        this.activeTag = null;
        this.activeLayout = null;
        this.activeOptions = 0;
        this.plugin.openTag(null, null);
        this.tagTabActive = false;
        this.tagTabFirstChildIdx = -1;
    }

    private init(): void {
        const parent = this.client.getWidget(Bankmain.ITEMS_CONTAINER);
        if (!parent || this.parent) return;
        this.parent = parent;

        // Not really text, but just to capture the wheel.
        const scroll = this.widgets.createChild(parent, WidgetType.TEXT);
        this.scrollComponent = scroll;
        this.widgets.setHasListener(scroll);
        this.widgets.setNoScrollThrough(scroll);
        this.widgets.listen(scroll, { onScrollWheel: (event: { mouseY: number }) => this.scrollTab(event.mouseY) });

        this.upButton = this.createGraphic(parent, "", TabSprites.UP_ARROW, -1, TAB_WIDTH, BUTTON_HEIGHT, MARGIN, 0);
        this.widgets.setAction(this.upButton, 1, SCROLL_UP);
        this.widgets.addClickMask(this.upButton, WIDGET_DRAG_ON);
        this.widgets.setHasListener(this.upButton);
        this.widgets.listen(this.upButton, { onOp: () => this.scrollTab(-1) });

        this.downButton = this.createGraphic(parent, "", TabSprites.DOWN_ARROW, -1, TAB_WIDTH, BUTTON_HEIGHT, MARGIN, 0);
        this.widgets.setAction(this.downButton, 1, SCROLL_DOWN);
        this.widgets.addClickMask(this.downButton, WIDGET_DRAG_ON);
        this.widgets.setHasListener(this.downButton);
        this.widgets.listen(this.downButton, { onOp: () => this.scrollTab(1) });

        this.newTab = this.createGraphic(parent, "", TabSprites.NEW_TAB, -1, TAB_WIDTH, 39, MARGIN, 0);
        this.widgets.setHasListener(this.newTab);
        this.widgets.setAction(this.newTab, NEWTAB_OP_NEW_TAB, NEW_TAB);
        this.widgets.setAction(this.newTab, NEWTAB_OP_IMPORT_TAB, IMPORT_TAB);
        this.widgets.setAction(this.newTab, NEWTAB_OP_OPEN_TAB_MENU, OPEN_TAB_MENU);
        this.widgets.listen(this.newTab, { onOp: (event: WidgetActionEvent) => this.handleNewTab(event) });

        this.tabManager.clear();
        for (const name of this.tabManager.loadAllTabNames()) this.loadTab(name);

        this.tabScrollOffset = this.config.position();
        this.scrollTab(0);

        if (this.config.rememberTab() && this.config.tab()) {
            // The server resyncs the last vanilla tab when the bank is opened.
            this.client.setVarbit(BANK_CURRENTTAB, 0);
            const tab = this.config.tab();
            this.plugin.openTag(tab, this.layoutManager.loadLayout(tab));
        }
    }

    deinit(): void {
        this.enabled = false;
        this.activeTag = null;
        this.activeLayout = null;
        this.activeOptions = 0;
        this.plugin.openTag(null, null);
        this.upButton = this.downButton = this.newTab = this.scrollComponent = undefined;
        if (this.parent) {
            this.widgets.deleteAllChildren(this.parent);
            this.parent = undefined;
        }
        this.tabManager.clear();
    }

    // ------------------------------------------------------------------ ops

    private handleDeposit(option: string, target: string, inventory: boolean): void {
        const container = this.client.getItemContainer(inventory ? INV : WORN);
        if (!container) return;
        const items = container.getSlots().map((s) => s.itemId).filter((id) => id !== -1 && id !== undefined);

        if (target) {
            if (this.activeTag !== null && removeTags(target) === this.activeTag) {
                for (const item of items) this.tagManager.addTag(item, this.activeTag, false);
                this.reloadActiveTab();
            }
            return;
        }

        this.chatbox
            .openTextInput(`${inventory ? "Inventory" : "Equipment"} tags:`)
            .addCharValidator(charValidator)
            .onDone((newTags: string) => {
                const tags = fromCSV(newTags.toLowerCase());
                for (const item of items) this.tagManager.addTags(item, tags, false);
                this.reloadActiveTab();
            })
            .build();
        void option;
    }

    private handleNewTab(event: WidgetActionEvent): void {
        switch ((event.opIndex ?? 0) - 1) {
            case NEWTAB_OP_NEW_TAB:
                this.chatbox
                    .openTextInput("Tag name")
                    .addCharValidator(charValidator)
                    .onDone((tagName: string) => {
                        if (!tagName) return;
                        this.loadTab(tagName);
                        this.tabManager.save();
                        this.repositionButtons();
                        this.rebuildTabs();
                        this.rebuildTagTabTab();
                    })
                    .build();
                break;
            case NEWTAB_OP_IMPORT_TAB:
                void this.clipboard.read().then(
                    (text) => this.importFromClipboard(text.trim()),
                    () => this.sendChatMessage("Failed to import tag tab from clipboard, invalid format."),
                );
                break;
            case NEWTAB_OP_OPEN_TAB_MENU:
                this.client.setVarbit(BANK_CURRENTTAB, 0);
                this.plugin.openTag(TAGTABS, null, 0);
                break;
        }
    }

    /** NEWTAB_OP_IMPORT_TAB, with the clipboard's text. */
    importFromClipboard(dataString: string): void {
        let tab: TagTab | null;
        try {
            const data = fromCSV(dataString)[Symbol.iterator]();
            tab = dataString.startsWith("banktaglayoutsplugin") ? this.importBtlTag(data) : this.importTag(data);
        } catch {
            tab = null;
        }
        if (!tab) {
            this.sendChatMessage("Failed to import tag tab from clipboard, invalid format.");
            return;
        }
        this.tabManager.add(tab);
        this.tabManager.save();
        if (this.parent) {
            this.repositionButtons();
            this.rebuildTabs();
            this.rebuildTagTabTab();
        }
        if (tab.tag === this.activeTag) this.bankSearch.reset(true);
        this.sendChatMessage(`Tag tab '${tab.tag}' has been imported from your clipboard!`);
    }

    private importTag(data: Iterator<string>): TagTab | null {
        let name = next(data);
        if (name === "banktags") {
            next(data); // version
            name = next(data);
        }
        name = filterTagName(name);
        if (!name) return null;

        const tab = this.tabManager.load(name);
        tab.iconItemId = parseIntStrict(next(data));

        let token = data.next();
        for (; !token.done; token = data.next()) {
            if (token.value === "layout") break;
            const itemId = parseIntStrict(token.value);
            this.tagManager.addTag(itemId, name, itemId < 0);
        }

        if (!token.done) {
            const layout = new Layout(name);
            for (let t = data.next(); !t.done; t = data.next()) {
                const idx = parseIntStrict(t.value);
                const itemId = parseIntStrict(next(data));
                layout.setItemAtPos(itemId, idx);
                this.tagManager.addTag(itemId, name, false);
            }
            this.layoutManager.saveLayout(layout);
        }
        return tab;
    }

    /** The Bank Tag Layouts plugin's export format. */
    private importBtlTag(data: Iterator<string>): TagTab | null {
        const header = next(data);
        const name = filterTagName(header.substring("banktaglayoutsplugin:".length));
        if (!name) return null;

        const tab = this.tabManager.load(name);
        const layout = new Layout(name);
        for (;;) {
            const token = next(data);
            if (token.startsWith("banktag:")) break;
            const [item, idx] = token.split(":");
            layout.setItemAtPos(parseIntStrict(item), parseIntStrict(idx));
        }
        tab.iconItemId = parseIntStrict(next(data));
        for (let t = data.next(); !t.done; t = data.next()) {
            const itemId = parseIntStrict(t.value);
            this.tagManager.addTag(itemId, name, itemId < 0);
        }
        this.layoutManager.saveLayout(layout);
        return tab;
    }

    private opTagTab(event: WidgetActionEvent): void {
        const source = event.widget as WidgetNode;
        const opbase = this.widgets.getName(source);
        switch ((event.opIndex ?? 0) - 1) {
            case TAB_OP_OPEN_TAG: {
                this.client.setVarbit(BANK_CURRENTTAB, 0);
                const tag = removeTags(opbase);
                if (tag === this.activeTag) this.closeTag(true);
                else this.plugin.openTag(tag, this.layoutManager.loadLayout(tag));
                this.client.playSoundEffect(SOUND_UI_BOOP);
                break;
            }
            case TAB_OP_CHANGE_ICON: {
                const tag = removeTags(opbase);
                new ChatboxItemSearch(this.chatbox, {
                    getItemCount: () => this.client.getItemCount(),
                    getCanonicalItem: (id) => {
                        const def = this.client.getItemDefinition(this.client.canonicalize(id));
                        return def
                            ? {
                                  id: def.id,
                                  name: def.name,
                                  inventoryModel: (def as any).model,
                                  ambient: def.ambient,
                                  contrast: def.contrast,
                                  recolorTo: def.recolorTo,
                                  retextureTo: def.retextureTo,
                              }
                            : undefined;
                    },
                })
                    .tooltipText(`${CHANGE_ICON} (${tag})`)
                    .onItemSelected((itemId) => {
                        const tab = this.tabManager.find(tag);
                        if (!tab) return;
                        tab.iconItemId = itemId;
                        this.tabManager.save();
                        if (this.parent) {
                            this.rebuildTabs();
                            this.rebuildTagTabTab();
                        }
                    })
                    .build();
                break;
            }
            case TAB_OP_LAYOUT: {
                const tag = removeTags(opbase);
                let layout = this.layoutManager.loadLayout(tag);
                if (layout === null) {
                    layout = new Layout(tag);
                    this.layoutManager.saveLayout(layout);
                    this.sendChatMessage(`Tag tab '${tag}' is now in layout mode. You may reorder the items without changing their order in the bank.`);
                } else {
                    this.layoutManager.removeLayout(tag);
                    layout = null;
                    this.sendChatMessage(`Tag tab '${tag}' is no longer in layout mode`);
                }
                if (tag === this.activeTag) this.plugin.openTag(tag, layout);
                this.bankSearch.layoutBank();
                break;
            }
            case TAB_OP_DELETE_TAB: {
                const target = standardize(opbase);
                this.chatbox
                    .openTextMenuInput(`Delete ${target}`)
                    .option("1. Tab and tag from all items", () => {
                        this.tagManager.removeTag(target);
                        this.deleteTab(target);
                    })
                    .option("2. Only tab", () => this.deleteTab(target))
                    .option("3. Cancel", () => {})
                    .build();
                break;
            }
            case TAB_OP_EXPORT_TAB: {
                const tagTab = this.tabManager.find(removeTags(opbase));
                if (!tagTab) break;
                const data = this.exportTab(tagTab);
                void this.clipboard.write(data).then(
                    () => this.sendChatMessage(`Tag tab '${tagTab.tag}' has been copied to your clipboard!`),
                    () => this.sendChatMessage(`Unable to copy tag tab '${tagTab.tag}' to your clipboard.`),
                );
                break;
            }
            case TAB_OP_RENAME_TAB:
                this.renameTab(standardize(opbase));
                break;
        }
    }

    /** TAB_OP_EXPORT_TAB's text: banktags,1,<tag>,<icon>,<items not in the layout>[,layout,<pos>,<item>...]. */
    exportTab(tagTab: TagTab): string {
        const layout = this.layoutManager.loadLayout(tagTab.tag);
        const data: (string | number)[] = ["banktags", "1", tagTab.tag, tagTab.iconItemId];
        for (const item of this.tagManager.getItemsForTag(tagTab.tag)) {
            if (layout === null || layout.count(item) === 0) data.push(item);
        }
        if (layout !== null) {
            data.push("layout");
            layout.getLayout().forEach((id, idx) => {
                if (id !== -1) data.push(idx, id);
            });
        }
        return toCSV(data);
    }

    /** MenuEntryAdded: Bank Tags' options on bank items and the deposit buttons. */
    addMenuEntries(entries: SimpleMenuEntry[], ctx: BankMenuContext): SimpleMenuEntry[] {
        const out = [...entries];
        // RuneLite's createMenuEntry(-1) as Examine is added: just above it.
        const aboveExamine = (entry: SimpleMenuEntry) => out.splice(examineSlot(out), 0, entry);
        const target = itemTarget(out);

        if ((this.activeOptions & OPTION_ALLOW_MODIFICATIONS) !== 0 && ctx.componentId === Bankmain.ITEMS && isBankItemMenu(out)) {
            if (this.activeLayout !== null) {
                aboveExamine(this.entry(DUPLICATE_ITEM, target, () => this.opDuplicateItem(ctx.itemId, ctx.childIndex)));
            }
            if (this.activeLayout !== null && this.activeLayout.count(this.client.canonicalize(ctx.itemId)) > 1) {
                aboveExamine(this.entry(REMOVE_LAYOUT, target, () => this.opRemoveLayout(ctx.childIndex)));
            } else if (this.activeTag !== null) {
                const hidden = this.tagManager.isHidden(this.activeTag);
                const option = !hidden && (this.activeOptions & OPTION_HIDE_TAG_NAME) === 0 ? `${REMOVE_TAG} (${this.activeTag})` : REMOVE_TAG;
                const activeTag = this.activeTag;
                aboveExamine(
                    this.entry(option, target, () => {
                        if (this.activeLayout !== null) {
                            this.activeLayout.removeItem(ctx.itemId);
                            this.layoutManager.saveLayout(this.activeLayout);
                        }
                        this.tagManager.removeTag(ctx.itemId, activeTag);
                        // Lay out again to filter the removed item out.
                        this.bankSearch.layoutBank();
                    }),
                );
            }
        } else if (this.activeTag !== null && ctx.componentId === Bankmain.ITEMS) {
            // Duplicate and Remove on layout placeholders: handled here, never sent to the server.
            for (const entry of out) {
                if (entry.option === DUPLICATE_ITEM) this.ownEntry(entry, () => this.opDuplicateItem(ctx.itemId, ctx.childIndex));
                else if (entry.option === REMOVE_LAYOUT) this.ownEntry(entry, () => this.opRemoveLayout(ctx.childIndex));
            }
        }

        if (ctx.componentId === Bankmain.DEPOSITINV || ctx.componentId === Bankmain.DEPOSITWORN) {
            const inventory = ctx.componentId === Bankmain.DEPOSITINV;
            const option = inventory ? TAG_INVENTORY : TAG_GEAR;
            const vanilla = inventory ? "Deposit inventory" : "Deposit worn items";
            const at = out.findIndex((e) => e.option === vanilla);
            if (at >= 0) {
                const added = [this.entry(option, out[at].target ?? "", () => this.handleDeposit(option, "", inventory))];
                if (
                    this.activeTag !== null &&
                    !this.tagManager.isHidden(this.activeTag) &&
                    (this.activeOptions & (OPTION_ALLOW_MODIFICATIONS | OPTION_HIDE_TAG_NAME)) === OPTION_ALLOW_MODIFICATIONS
                ) {
                    const target = wrapWithColorTag(this.activeTag, MENU_TARGET_COLOR);
                    added.unshift(this.entry(option, target, () => this.handleDeposit(option, target, inventory)));
                }
                // createMenuEntry(-1) as the deposit option is added: above it, the last one on top.
                out.splice(at, 0, ...added);
            }
        }
        return this.layoutManager.addMenuEntries(out, ctx, this);
    }

    private entry(option: string, target: string | undefined, onClick: () => void): SimpleMenuEntry {
        return { option, target: target ?? "", onClick: () => onClick() };
    }

    private ownEntry(entry: SimpleMenuEntry, onClick: () => void): void {
        entry.onClick = () => onClick();
        entry.deprioritized = true;
    }

    private opDuplicateItem(itemId: number, pos: number): void {
        if (!this.activeLayout) return;
        this.activeLayout.addItemAfter(this.client.canonicalize(itemId), pos);
        this.layoutManager.saveLayout(this.activeLayout);
        this.bankSearch.layoutBank();
    }

    private opRemoveLayout(pos: number): void {
        if (!this.activeLayout) return;
        this.activeLayout.removeItemAtPos(pos);
        this.layoutManager.saveLayout(this.activeLayout);
        this.bankSearch.layoutBank();
    }

    /** MenuOptionClicked. Return true to keep the click from the server. */
    onMenuOptionClicked(event: WidgetActionEvent): boolean {
        const option = String(event.option ?? "");
        const componentId = this.widgets.id(event.widget as WidgetNode);
        // Clicking in the bank closes the chatbox input, as withdrawing or changing tab closes
        // the game's own inputs.
        if (this.chatbox.getCurrentInput() && option !== SCROLL_UP && option !== SCROLL_DOWN) {
            const group = componentId >>> 16;
            if (group === 12 || group === 15) this.chatbox.close();
        }
        if (option.startsWith("View tab") || option === "View all items" || componentId === Bankmain.POTIONSTORE_BUTTON) {
            this.closeTag(false);
        }
        // A layout placeholder's options are right-click only and never reach the server
        // (RuneLite's RUNELITE_LOW_PRIORITY): a left click does nothing.
        if (componentId === Bankmain.ITEMS && this.activeTag !== null && (option === DUPLICATE_ITEM || option === REMOVE_LAYOUT)) {
            return true;
        }
        this.layoutManager.onMenuOptionClicked(event);
        return false;
    }

    /** WidgetDrag: every cycle while dragging, and once on release. */
    onWidgetDrag(released: boolean): void {
        if (!this.enabled || !this.parent) return;
        const draggedWidget = this.client.getDraggedWidget();
        const draggedOn = this.client.getDraggedOnWidget();
        if (!draggedWidget) return;
        const draggedId = this.widgets.id(draggedWidget);

        // Cancelling the drop is how a drag is ignored.
        if (
            draggedId === Bankmain.ITEMS &&
            this.activeTag !== null &&
            ((this.activeLayout === null && this.config.preventTagTabDrags()) || (this.activeOptions & OPTION_ALLOW_MODIFICATIONS) === 0)
        ) {
            this.client.setDraggedOnWidget(undefined);
        }

        const shiftDown = this.client.isShiftPressed();
        if (!draggedOn) return;

        if (released) {
            const parentUid = this.parent.uid;
            const onTab = (w: WidgetNode) => (w as any).parentUid === parentUid && this.widgets.index(w) >= TAGTAB_CHILD_OFFSET;
            if (!this.tagTabActive && draggedId === Bankmain.ITEMS && (draggedWidget.itemId ?? -1) !== -1 && onTab(draggedOn)) {
                // An item dragged onto a tag tab is tagged with it.
                this.tagManager.addTag(draggedWidget.itemId!, this.widgets.getName(draggedOn), shiftDown);
                this.client.setDraggedOnWidget(undefined);
                this.reloadActiveTab();
            } else if (
                (this.tagTabActive && draggedId === Bankmain.ITEMS && this.widgets.id(draggedOn) === Bankmain.ITEMS) ||
                (onTab(draggedWidget) && onTab(draggedOn))
            ) {
                // Reorder the tag tabs.
                this.client.setDraggedOnWidget(undefined);
                this.moveTagTab(draggedWidget, draggedOn);
            } else if (onTab(draggedWidget)) {
                // Rebuild, or the dragged tab is left over (it isn't hidden while laid out).
                queueMicrotask(() => this.parent && this.rebuildTabs());
            }
        } else if (draggedOn === this.upButton) {
            this.scrollTick(-1);
        } else if (draggedOn === this.downButton) {
            this.scrollTick(1);
        }
    }

    private moveTagTab(source: WidgetNode, dest: WidgetNode): void {
        const destName = this.widgets.getName(dest);
        if (!destName) return;
        if (this.client.getVarbitValue(BANK_INSERTMODE) === 0) this.tabManager.swap(this.widgets.getName(source), destName);
        else this.tabManager.insert(this.widgets.getName(source), destName);
        this.tabManager.save();
        this.rebuildTabs();
        this.rebuildTagTabTab();
    }

    private addTabActions(tab: TagTab, w: WidgetNode): void {
        this.widgets.setAction(w, TAB_OP_OPEN_TAG, VIEW_TAB);
        this.widgets.setAction(w, TAB_OP_CHANGE_ICON, CHANGE_ICON);
        if (tab.tag !== TAGTABS) {
            const layout = this.layoutManager.loadLayout(tab.tag);
            this.widgets.setAction(w, TAB_OP_LAYOUT, layout !== null ? DISABLE_LAYOUT : ENABLE_LAYOUT);
        }
        this.widgets.setAction(w, TAB_OP_EXPORT_TAB, EXPORT_TAB);
        this.widgets.setAction(w, TAB_OP_RENAME_TAB, RENAME_TAB);
        this.widgets.setAction(w, TAB_OP_DELETE_TAB, REMOVE_TAB);
        this.widgets.setHasListener(w);
        this.widgets.listen(w, { onOp: (event: WidgetActionEvent) => this.opTagTab(event) });
    }

    private addTabOptions(w: WidgetNode): void {
        this.widgets.addClickMask(w, WIDGET_DRAG | WIDGET_DRAG_ON);
        this.widgets.setDragDeadTime(w, 5);
        this.widgets.setDragDeadZone(w, 5);
        this.widgets.setItem(w, w.itemId ?? -1, 10000, ItemQuantityMode.NEVER);
    }

    private loadTab(tag: string): void {
        this.tabManager.add(this.tabManager.load(tag));
    }

    private deleteTab(tag: string): void {
        if (tag === this.activeTag) this.closeTag(true);
        this.tabManager.remove(tag);
        this.tabManager.save();
        this.layoutManager.removeLayout(tag);
        if (!this.parent) return;
        this.repositionButtons();
        this.rebuildTabs();
        this.rebuildTagTabTab();
        this.scrollTab(0);
    }

    private renameTab(oldTag: string): void {
        this.chatbox
            .openTextInput(`Enter new tag name for tag "${oldTag}":`)
            .addCharValidator(charValidator)
            .onDone((newTag: string) => {
                newTag = standardize(newTag);
                if (!newTag || newTag === oldTag) return;
                if (this.tabManager.find(newTag) === undefined) {
                    const tagTab = this.tabManager.find(oldTag);
                    if (!tagTab) return;
                    const layout = this.layoutManager.loadLayout(oldTag);

                    this.tabManager.remove(oldTag); // the icon
                    this.layoutManager.removeLayout(oldTag);
                    tagTab.tag = newTag;
                    this.tabManager.add(tagTab);
                    this.tabManager.save();
                    if (this.activeTag === oldTag) this.activeTag = newTag;
                    if (layout !== null) this.layoutManager.saveLayout(new Layout(newTag, layout.getLayout()));
                    this.tagManager.renameTag(oldTag, newTag);
                    if (this.parent) {
                        this.rebuildTabs();
                        this.rebuildTagTabTab();
                    }
                    this.reloadActiveTab();
                } else {
                    this.chatbox
                        .openTextMenuInput("The specified bank tag already exists.")
                        .option(`1. Merge into existing tag "${newTag}".`, () => {
                            this.tagManager.renameTag(oldTag, newTag);
                            this.deleteTab(oldTag);
                            if (oldTag === this.activeTag) this.plugin.openBankTag(newTag);
                            else this.reloadActiveTab();
                        })
                        .option("2. Choose a different name.", () => this.renameTab(oldTag))
                        .build();
                }
            })
            .build();
    }

    private scrollTick(direction: number): void {
        // Keeps dragging over the scroll buttons from scrolling too fast.
        if (this.now() - this.startScroll >= SCROLL_TICK) {
            this.startScroll = this.now();
            this.scrollTab(direction);
        }
    }

    private scrollTab(d: number): void {
        this.tabScrollOffset += d;
        const maxScroll = this.tabManager.size() - this.tabCount;
        if (this.tabScrollOffset > maxScroll) this.tabScrollOffset = maxScroll;
        if (this.tabScrollOffset < 0) this.tabScrollOffset = 0;
        this.config.setPosition(this.tabScrollOffset);
        this.layoutTabs();
    }

    openTag(tag: string, layout: Layout | null, options: number, relayout: boolean): void {
        this.activeTag = tag;
        this.activeLayout = layout;
        this.activeOptions = options;
        this.tagTabActive = tag === TAGTABS;
        this.config.setTab(tag);
        if (relayout) this.bankSearch.reset(true);
    }

    closeTag(relayout: boolean): void {
        this.activeTag = null;
        this.activeLayout = null;
        this.activeOptions = 0;
        this.tagTabActive = false;
        this.plugin.openTag(null, null);
        this.config.setTab("");
        if (relayout) this.bankSearch.reset(true);
    }

    reloadActiveTab(): void {
        if (this.activeTag !== null) this.plugin.openBankTag(this.activeTag);
    }

    private repositionButtons(): void {
        const parent = this.parent;
        const scroll = this.scrollComponent;
        if (!parent || !scroll || !this.upButton || !this.downButton) return;
        let height = this.widgets.height(parent) - BANK_BOTTOM_OFFSET;

        const visible = (id: number) => {
            const w = this.client.getWidget(id);
            return w && !this.widgets.isHidden(w) ? w : undefined;
        };
        const incinerator = visible(Bankmain.INCINERATOR_TARGET);
        if (incinerator) height = Math.min(height, this.widgets.relativeY(incinerator));
        const popupOut = visible(Bankmain.POPUP_BUTTON_OUT);
        if (popupOut) height = Math.min(height, this.widgets.relativeY(popupOut));
        const popupTab = visible(Bankmain.STORAGE_POPUP_TAB);
        if (popupTab) {
            for (const id of [Bankmain.GIM_STORAGE, Bankmain.POTIONSTORE_BUTTON]) {
                const w = visible(id);
                if (w) height = Math.min(height, this.widgets.relativeY(popupTab) + this.widgets.relativeY(w));
            }
        }

        this.widgets.setOriginalY(scroll, 41 + BUTTON_HEIGHT);
        this.widgets.setOriginalWidth(scroll, TAB_WIDTH + MARGIN * 2);
        // Keep the tab layer a whole number of tabs high.
        const tabLayerHeight = height - (41 + BUTTON_HEIGHT) - BUTTON_HEIGHT;
        this.tabCount = Math.max(0, Math.floor(tabLayerHeight / (TAB_HEIGHT + MARGIN)));
        this.widgets.setOriginalHeight(scroll, this.tabCount * (TAB_HEIGHT + MARGIN));
        this.widgets.revalidate(scroll);

        this.widgets.setOriginalY(this.upButton, 41);
        this.widgets.revalidate(this.upButton);
        this.widgets.setOriginalY(this.downButton, 41 + BUTTON_HEIGHT + this.tabCount * (TAB_HEIGHT + MARGIN) + MARGIN);
        this.widgets.revalidate(this.downButton);
    }

    private rebuildTabs(): void {
        const parent = this.parent;
        if (!parent) return;
        // Remove the tag tabs, keeping the buttons and the scroll component.
        this.widgets.truncateChildren(parent, TAGTAB_CHILD_OFFSET);
        for (const tab of this.tabManager.tabs) {
            const name = wrapWithColorTag(tab.tag, MENU_TARGET_COLOR);
            const sprite = tab.tag === this.activeTag ? TabSprites.TAB_BACKGROUND_ACTIVE : TabSprites.TAB_BACKGROUND;
            const background = this.createGraphic(parent, name, sprite, -1, TAB_WIDTH, TAB_HEIGHT, MARGIN, -1);
            this.addTabActions(tab, background);

            const icon = this.createGraphic(parent, name, -1, tab.iconItemId, ITEM_SPRITE_WIDTH, ITEM_SPRITE_HEIGHT, MARGIN + 3, -1);
            this.addTabOptions(icon);
        }
        this.layoutTabs();
    }

    /** Positions the tabs for the scroll offset and the bank's height. */
    private layoutTabs(): void {
        const parent = this.parent;
        const scroll = this.scrollComponent;
        if (!parent || !scroll) return;
        const children = this.widgets.children(parent);
        const dragged = this.client.getDraggedWidget();
        for (let i = TAGTAB_CHILD_OFFSET; i < children.length; ++i) {
            // Don't hide the dragged tab while scrolling during the drag.
            if (children[i] && children[i] !== dragged) this.widgets.setHidden(children[i], true);
        }

        let y = (scroll.rawY ?? 0) + MARGIN;
        for (
            let i = this.tabScrollOffset;
            i < this.tabScrollOffset + this.tabCount && i * 2 + 1 < children.length - TAGTAB_CHILD_OFFSET && children[TAGTAB_CHILD_OFFSET + i * 2];
            ++i
        ) {
            const background = children[TAGTAB_CHILD_OFFSET + i * 2];
            this.widgets.setOriginalY(background, y);
            this.widgets.setHidden(background, false);
            this.widgets.revalidate(background);

            const icon = children[TAGTAB_CHILD_OFFSET + i * 2 + 1];
            this.widgets.setOriginalY(icon, y + 4);
            this.widgets.setHidden(icon, false);
            this.widgets.revalidate(icon);

            y += TAB_HEIGHT + MARGIN;
        }
    }

    /**
     * The tag tab tab: every tab as an item in the bank's item container. They go after the real
     * items, which is simpler than a layer of their own (the bank's scrollbar would need it too).
     */
    private rebuildTagTabTab(): number {
        let itemX = BANK_ITEM_START_X;
        let itemY = BANK_ITEM_START_Y;
        let rowIndex = 0;

        const parent = this.client.getWidget(Bankmain.ITEMS);
        if (!parent) return 0;
        if (this.tagTabFirstChildIdx === -1) this.tagTabFirstChildIdx = this.widgets.children(parent).length;

        for (let idx = this.tagTabFirstChildIdx, w; (w = this.widgets.child(parent, idx)); idx++) this.widgets.setHidden(w, true);
        if (!this.tagTabActive) return 0;

        let idx = this.tagTabFirstChildIdx;
        for (const tagTab of this.tabManager.tabs) {
            let menu = this.widgets.child(parent, idx++);
            if (!menu) {
                menu = this.widgets.createChild(parent, WidgetType.GRAPHIC);
                this.widgets.setOriginalWidth(menu, BANK_ITEM_WIDTH);
                this.widgets.setOriginalHeight(menu, BANK_ITEM_HEIGHT);
            }
            this.widgets.setHidden(menu, false);
            this.widgets.setOriginalX(menu, itemX);
            this.widgets.setOriginalY(menu, itemY);
            this.widgets.setName(menu, wrapWithColorTag(tagTab.tag, MENU_TARGET_COLOR));
            this.widgets.setItem(menu, tagTab.iconItemId, -1);
            this.widgets.setBorderType(menu, 1);
            this.addTabActions(tagTab, menu);
            this.addTabOptions(menu);
            this.widgets.revalidate(menu);

            rowIndex++;
            if (rowIndex === BANK_ITEMS_PER_ROW) {
                itemX = BANK_ITEM_START_X;
                itemY += BANK_ITEM_Y_PADDING + BANK_ITEM_HEIGHT;
                rowIndex = 0;
            } else {
                itemX += BANK_ITEM_X_PADDING + BANK_ITEM_WIDTH;
            }
        }
        return itemY + BANK_ITEM_HEIGHT;
    }

    /** Hides the bank's items and separators. */
    private hideBank(): void {
        for (const w of this.widgets.children(this.client.getWidget(Bankmain.ITEMS))) if (w) this.widgets.setHidden(w, true);
    }

    private createGraphic(container: WidgetNode, name: string, spriteId: number, itemId: number, width: number, height: number, x: number, y: number): WidgetNode {
        const widget = this.widgets.createChild(container, WidgetType.GRAPHIC);
        this.widgets.setOriginalWidth(widget, width);
        this.widgets.setOriginalHeight(widget, height);
        this.widgets.setOriginalX(widget, x);
        this.widgets.setOriginalY(widget, y);
        this.widgets.setSpriteId(widget, spriteId);
        if (itemId > -1) {
            this.widgets.setItem(widget, itemId, -1);
            this.widgets.setBorderType(widget, 1);
        }
        this.widgets.setName(widget, name);
        this.widgets.revalidate(widget);
        return widget;
    }

    private sendChatMessage(message: string): void {
        this.client.sendChatMessage(message);
    }

    /** Whether the bank interface is open (RuneLite: the bank's item container exists). */
    bankOpen(): boolean {
        return this.client.getItemContainer(BANK) !== undefined;
    }
}

/** TabInterface.FILTERED_CHARS as a char-code validator. */
export function charValidator(c: number): boolean {
    return isAllowedTagChar(String.fromCharCode(c));
}

function filterTagName(name: string): string {
    return Array.from(name).filter(isAllowedTagChar).join("");
}

function next(it: Iterator<string>): string {
    const r = it.next();
    if (r.done) throw new Error("no such element");
    return r.value;
}

function parseIntStrict(text: string): number {
    if (!/^-?\d+$/.test(text.trim())) throw new Error(`not a number: ${text}`);
    return parseInt(text, 10);
}
