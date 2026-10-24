import { getCustomInterface } from "../../common/gamemode/GamemodeContentStore";
import { IndexType } from "../../rs/cache/IndexType";
import { markWidgetInteractionDirty } from "../WidgetInteraction";
import type { WidgetManager } from "../WidgetManager";

/**
 * Server-declared behaviour for a custom widget group: a search box, a virtual list of
 * results, and the status text around them. The client knows how to type, scroll and
 * render; it never knows what is being searched.
 *
 * The declaration arrives over the content-data channel alongside the widget group, and
 * the rows come from the endpoint it names, so a plugin can add an interface like this
 * without a single client change.
 */
export type CustomInterfaceDeclaration = {
    groupId: number;
    search?: {
        /** Text component the typed query is rendered into. */
        inputComponent: number;
        /** Optional box behind the input, recoloured while focused. */
        backgroundComponent?: number;
        /** Components that take focus when clicked; defaults to the input and its box. */
        focusComponents?: number[];
        maxLength?: number;
        /** Shown when the query is empty and the box is not focused. */
        placeholder?: string;
        caret?: string;
        /** "%s" is replaced with the typed text. */
        textTemplate?: string;
        focusColor?: number;
        blurColor?: number;
        blurHoverColor?: number;
        /** Content endpoint path, e.g. "/api/content/items". */
        endpoint?: string;
        /** Hidden text component receiving JSON rows over the authenticated game socket. */
        dataComponent?: number;
        /**
         * More hidden components whose rows follow `dataComponent`'s, in order. A widget text
         * packet carries at most 64 KB, so a long list arrives in parts.
         */
        extraDataComponents?: number[];
        queryParam?: string;
        limit?: number;
        debounceMs?: number;
    };
    list?: {
        viewComponent: number;
        scrollbarComponent?: number;
        slotCount: number;
        columns: number;
        rowHeight: number;
        iconStart: number;
        iconBaseY?: number;
        backgroundStart: number;
        backgroundBaseY?: number;
        /**
         * Text components drawn beside the icons. Without them the icon component carries
         * the label too; with them the icons show each row's `icon` item instead of its id.
         */
        labelStart?: number;
        labelBaseY?: number;
        /** "%name", "%id" and "%detail" are replaced per row. */
        itemLabel?: string;
        /** The label of a header row; "%name" is replaced. */
        headerLabel?: string;
        /** Clicking a row sends its id to the server as the action's slot. */
        clickable?: boolean;
        /**
         * Shows a clicked row's details at once, without waiting a tick for the server: each
         * `texts` component takes the row's `panel` value of that name, `iconComponent` takes
         * its icon, and `showComponents` appear. Only the `op` click selects (default op 1).
         */
        select?: {
            op?: number;
            texts?: Record<string, number>;
            iconComponent?: number;
            showComponents?: number[];
        };
        /** Text lists have no inventory item associated with each row. */
        textOnly?: boolean;
    };
    /**
     * Containers that scroll their own children. The rows are part of the definition, so
     * the client only has to give the view a scroll height and wire up a scrollbar.
     */
    scroll?: Array<{
        viewComponent: number;
        scrollbarComponent?: number;
        contentHeight?: number;
    }>;
    status?: {
        component: number;
        idle?: string;
        loading?: string;
        empty?: string;
        error?: string;
        /** "%shown" and "%total" are replaced. */
        matches?: string;
        truncated?: string;
    };
    hint?: { component: number; text: string };
    /**
     * Tabs switched client-side, with no wait for the server. The data component then holds a
     * catalog of every row once, and `layoutComponent` receives
     * `{ active?, tabs: [[rowId | { header }]] }`: each tab's rows in order, with section
     * headers. A tab click (still sent to the server) shows that tab's rows, recolours the
     * labels and, with `clearQuery`, empties the search. A layout without `active` keeps the
     * player's current tab, so a refresh can't pull them back to an older one.
     */
    tabs?: {
        components: number[];
        labelComponents: number[];
        labels: string[];
        /** "%s" is replaced with the tab's label. */
        activeTemplate?: string;
        inactiveTemplate?: string;
        layoutComponent: number;
        clearQuery?: boolean;
    };
};

export type CustomInterfaceRow = {
    id: number;
    name: string;
    /** Item shown in the row's icon slot, for lists with separate labels. */
    icon?: number;
    /** Plain text for the label's "%detail". */
    detail?: string;
    /** Extra words the search matches, never shown. */
    terms?: string;
    /** A section title: not clickable, and kept only while a row under it matches. */
    header?: boolean;
    /** Text for the declared select panel, by name; server markup is kept. */
    panel?: Record<string, string>;
};

function toRow(row: any): CustomInterfaceRow {
    return {
        id: row.id | 0,
        name: String(row.name ?? ""),
        icon: Number.isInteger(row.icon) ? row.icon : undefined,
        detail: typeof row.detail === "string" ? row.detail : undefined,
        terms: typeof row.terms === "string" ? row.terms : undefined,
        header: row.header === true,
        panel: row.panel && typeof row.panel === "object"
            ? Object.fromEntries(
                  Object.entries(row.panel).filter(([, value]) => typeof value === "string"),
              ) as Record<string, string>
            : undefined,
    };
}

/** Rows matching the query, with each header kept only while a row under it matches. */
export function filterRows(rows: CustomInterfaceRow[], query: string): CustomInterfaceRow[] {
    const term = query.trim().toLowerCase();
    const result: CustomInterfaceRow[] = [];
    let header: CustomInterfaceRow | undefined;
    for (const row of rows) {
        if (row.header) {
            header = row;
            continue;
        }
        const text = `${row.name} ${row.terms ?? ""}`.toLowerCase();
        if (!text.includes(term)) continue;
        if (header) {
            result.push(header);
            header = undefined;
        }
        result.push(row);
    }
    return result;
}

// Standard cache scrollbar scripts and sprites - the same ones cache interfaces use.
const SCROLLBAR_INIT_SCRIPT_ID = 31;
const SCROLLBAR_RESIZE_SCRIPT_ID = 72;
const SCROLLBAR_GRAPHICS = [
    "scrollbar_dragger_v2,3",
    "scrollbar_dragger_v2,0",
    "scrollbar_dragger_v2,1",
    "scrollbar_dragger_v2,2",
    "scrollbar_v2,0",
    "scrollbar_v2,1",
] as const;

const OSRS_KEY_ENTER = 84;
const OSRS_KEY_BACKSPACE = 85;
const OSRS_KEY_ESCAPE = 13;
const DEFAULT_DEBOUNCE_MS = 120;
const DEFAULT_LIMIT = 250;
const DEFAULT_MAX_LENGTH = 60;

export type CustomInterfaceRuntimeDeps = {
    widgetManager: WidgetManager;
    getCacheSystem: () =>
        | { getIndex?: (indexId: number) => { getArchiveId?: (token: string) => number } }
        | undefined;
    runWidgetScopedClientScript: (
        widgetUid: number,
        scriptId: number,
        args: (number | string)[],
        phase: "pre" | "post" | "run_script",
    ) => void;
    fetchContent: (path: string) => Promise<unknown>;
};

function sanitize(value: string | undefined): string {
    return String(value ?? "").replace(/[<>]/g, "");
}

export class CustomInterfaceRuntime {
    private declaration?: CustomInterfaceDeclaration;
    private focused = false;
    private query = "";
    private rows: CustomInterfaceRow[] = [];
    private sourceRows: CustomInterfaceRow[] = [];
    private total = 0;
    private renderedVersion = -1;
    private version = 0;
    private visibleStartRow = -1;
    /** Row shown in each list slot, for clickable lists. */
    private slotRows: (CustomInterfaceRow | undefined)[] = [];
    private labelActions = new Map<number, unknown>();
    private selectedRowId: number | undefined;
    private catalog = new Map<number, CustomInterfaceRow>();
    private dataParts: CustomInterfaceRow[][] = [];
    private tabLayouts: Array<Array<number | { header: string }>> = [];
    private activeTab = 0;
    private scrollbarState = new Map<number, string>();
    private fetchTimer: ReturnType<typeof setTimeout> | undefined;
    private fetchSequence = 0;
    private fetchState: "idle" | "loading" | "error" = "idle";

    constructor(private readonly deps: CustomInterfaceRuntimeDeps) {}

    isSearchFocused(): boolean {
        return this.focused;
    }

    /** True when this group is server-declared, i.e. the runtime owns its behaviour. */
    onInterfaceOpened(groupId: number): boolean {
        const declaration = getCustomInterface(groupId) as CustomInterfaceDeclaration | undefined;
        if (!declaration) {
            return false;
        }
        this.reset();
        this.declaration = declaration;
        this.focused = !!declaration.search;
        this.syncInput();
        this.applyHint();
        this.applyTabLabels();
        this.applyScrollRegions();
        this.renderRows(true);
        return true;
    }

    onInterfaceClosed(groupId: number): void {
        if (((this.declaration?.groupId ?? -1) | 0) === (groupId | 0)) {
            this.reset();
        }
    }

    /** The server can drive the query too - prefill, clear, or correct it. */
    handleSetText(uid: number, text: string): boolean {
        const search = this.declaration?.search;
        const dataComponents = search?.dataComponent === undefined
            ? []
            : [search.dataComponent, ...(search.extraDataComponents ?? [])];
        const part = dataComponents.findIndex((component) => uid === this.uid(component));
        if (part >= 0) {
            let rows: CustomInterfaceRow[] = [];
            try {
                const parsed = JSON.parse(text);
                rows = Array.isArray(parsed)
                    ? parsed
                          .filter((row) => Number.isInteger(row?.id) && row.id > 0 && typeof row.name === "string")
                          .map(toRow)
                    : [];
            } catch {
                rows = [];
            }
            this.dataParts[part] = rows;
            rows = dataComponents.flatMap((_, index) => this.dataParts[index] ?? []);
            if (this.declaration?.tabs) {
                this.catalog = new Map(rows.map((row) => [row.id, row]));
                this.sourceRows = this.tabRows();
            } else {
                this.sourceRows = rows;
            }
            // New data for the same list (a favourite toggled) keeps the scroll; a new query
            // starts from the top.
            this.scheduleFetch(false);
            if (this.selectedRowId !== undefined) this.applySelection(this.selectedRowId);
            return true;
        }
        const tabs = this.declaration?.tabs;
        if (tabs && uid === this.uid(tabs.layoutComponent)) {
            let layout: any;
            try {
                layout = JSON.parse(text);
            } catch {
                layout = undefined;
            }
            this.tabLayouts = Array.isArray(layout?.tabs)
                ? layout.tabs.map((tab: unknown) => (Array.isArray(tab) ? tab : []))
                : [];
            const opened = Number.isInteger(layout?.active);
            if (opened) this.activeTab = layout.active;
            this.applyTabLabels();
            this.sourceRows = this.tabRows();
            this.scheduleFetch(opened);
            if (this.selectedRowId !== undefined) this.applySelection(this.selectedRowId);
            return true;
        }
        if (!search || uid !== this.uid(search.inputComponent)) {
            return false;
        }
        this.query = sanitize(text);
        this.syncInput();
        this.scheduleFetch();
        return true;
    }

    /**
     * The id of the row a clickable list shows in the clicked slot: null for a header or an
     * empty slot, undefined when the component is not one of the list's slots.
     */
    rowIdAt(groupId: number, childId: number): number | null | undefined {
        const declaration = this.declaration;
        const list = declaration?.list;
        if (!list?.clickable || (groupId | 0) !== (declaration!.groupId | 0)) {
            return undefined;
        }
        for (const start of [list.iconStart, list.labelStart, list.backgroundStart]) {
            if (start === undefined) continue;
            const slot = (childId | 0) - start;
            if (slot >= 0 && slot < list.slotCount) {
                const row = this.slotRows[slot];
                return row && !row.header ? row.id : null;
            }
        }
        return undefined;
    }

    /** A widget op was sent: a declared tab switches its list now, not a tick later. */
    handleWidgetOp(groupId: number, childId: number): void {
        const declaration = this.declaration;
        const tabs = declaration?.tabs;
        if (!tabs || (groupId | 0) !== (declaration!.groupId | 0)) return;
        const index = [tabs.components, tabs.labelComponents].reduce(
            (found, components) => (found >= 0 ? found : components.indexOf(childId | 0)),
            -1,
        );
        if (index < 0) return;
        this.activeTab = index;
        this.applyTabLabels();
        this.sourceRows = this.tabRows();
        if (tabs.clearQuery) {
            this.query = "";
            this.syncInput();
        }
        this.scheduleFetch(true);
    }

    /** The active tab's rows from the catalog, with its section headers. */
    private tabRows(): CustomInterfaceRow[] {
        const rows: CustomInterfaceRow[] = [];
        (this.tabLayouts[this.activeTab] ?? []).forEach((entry, index) => {
            if (typeof entry === "number") {
                const row = this.catalog.get(entry);
                if (row) rows.push(row);
            } else if (entry && typeof entry.header === "string") {
                // Header ids only have to differ from each other and from the catalog's.
                rows.push({ id: -1 - index, name: entry.header, header: true });
            }
        });
        return rows;
    }

    private applyTabLabels(): void {
        const tabs = this.declaration?.tabs;
        if (!tabs) return;
        tabs.labelComponents.forEach((component, index) => {
            const template = index === this.activeTab
                ? tabs.activeTemplate ?? "%s"
                : tabs.inactiveTemplate ?? "%s";
            this.setText(component, template.replace("%s", tabs.labels[index] ?? ""));
        });
    }

    /** A clickable row was sent with this op: the select op shows the row's details now. */
    handleRowOp(rowId: number, opId: number): void {
        const select = this.declaration?.list?.select;
        if (!select || (opId | 0) !== (select.op ?? 1)) return;
        this.applySelection(rowId);
    }

    private applySelection(rowId: number): void {
        const select = this.declaration?.list?.select;
        const row = this.catalog.get(rowId)
            ?? this.sourceRows.find((candidate) => candidate.id === rowId && !candidate.header);
        if (!select || !row) return;
        this.selectedRowId = rowId;
        for (const [field, component] of Object.entries(select.texts ?? {})) {
            this.setText(component, row.panel?.[field] ?? "");
        }
        const icon = select.iconComponent === undefined ? undefined : this.widget(select.iconComponent);
        if (icon) {
            const itemId = row.icon ?? -1;
            icon.itemId = itemId;
            icon.itemQuantity = itemId >= 0 ? 1 : 0;
            icon.itemAmount = itemId >= 0 ? 1 : 0;
            markWidgetInteractionDirty(icon);
            this.deps.widgetManager.invalidateWidgetRender(icon);
        }
        for (const component of select.showComponents ?? []) {
            const widget = this.widget(component);
            if (!widget) continue;
            if (!widget.hidden && !widget.isHidden) continue;
            widget.hidden = false;
            widget.isHidden = false;
            markWidgetInteractionDirty(widget);
            // Showing can change layout, which hidden widgets skip.
            this.deps.widgetManager.invalidateWidget(widget, "custom-interface-select");
        }
    }

    handleWidgetClick(groupId: number, childId: number): boolean {
        const search = this.declaration?.search;
        if (!search) {
            return false;
        }
        const focusComponents = search.focusComponents ?? [
            search.inputComponent,
            search.backgroundComponent ?? search.inputComponent,
        ];
        const isFocusClick =
            (groupId | 0) === (this.declaration!.groupId | 0) &&
            focusComponents.includes(childId | 0);

        if (this.focused && !isFocusClick) {
            this.setFocus(false);
        }
        if (isFocusClick) {
            this.setFocus(true);
            return true;
        }
        return false;
    }

    handleSearchKeyEvents(keyEvents: Array<{ keyTyped: number; keyPressed: number }>): boolean {
        const search = this.declaration?.search;
        if (!search || !this.focused) {
            return false;
        }
        if (!this.isAttached()) {
            this.reset();
            return false;
        }

        const maxLength = search.maxLength ?? DEFAULT_MAX_LENGTH;
        let query = this.query;
        let changed = false;

        for (const keyEvent of keyEvents) {
            const typed = keyEvent.keyTyped | 0;
            if (typed === OSRS_KEY_ESCAPE) {
                this.setFocus(false);
                continue;
            }
            if (typed === OSRS_KEY_ENTER) {
                continue;
            }
            if (typed === OSRS_KEY_BACKSPACE) {
                if (query.length > 0) {
                    query = query.slice(0, -1);
                    changed = true;
                }
                continue;
            }
            if ((keyEvent.keyPressed | 0) <= 0 || query.length >= maxLength) {
                continue;
            }
            const char = String.fromCharCode(keyEvent.keyPressed | 0);
            if (!/^[ -~]$/.test(char)) {
                continue;
            }
            query += char;
            changed = true;
        }

        if (changed) {
            this.query = query;
            this.syncInput();
            this.scheduleFetch();
        }
        return true;
    }

    tick(): void {
        if (!this.declaration || !this.isAttached()) {
            return;
        }
        this.initializeScrollView();
        this.applyScrollRegions();
        this.refreshVisibleSlots();
    }

    private reset(): void {
        if (this.fetchTimer) {
            clearTimeout(this.fetchTimer);
            this.fetchTimer = undefined;
        }
        this.fetchSequence++;
        this.fetchState = "idle";
        this.declaration = undefined;
        this.focused = false;
        this.query = "";
        this.rows = [];
        this.sourceRows = [];
        this.total = 0;
        this.version = 0;
        this.renderedVersion = -1;
        this.visibleStartRow = -1;
        this.slotRows = [];
        this.selectedRowId = undefined;
        this.catalog = new Map();
        this.dataParts = [];
        this.tabLayouts = [];
        this.activeTab = 0;
        this.labelActions.clear();
        this.scrollbarState.clear();
    }

    private uid(component: number): number {
        return (((this.declaration?.groupId ?? 0) & 0xffff) << 16) | (component & 0xffff);
    }

    private widget(component: number): any {
        return this.deps.widgetManager.getWidgetByUid(this.uid(component));
    }

    private isAttached(): boolean {
        const groupId = this.declaration?.groupId;
        if (groupId === undefined) {
            return false;
        }
        return (
            (this.deps.widgetManager.getInterfaceParentContainerUid(groupId) ?? undefined) !==
            undefined
        );
    }

    private setFocus(focused: boolean): void {
        this.focused = !!focused && this.isAttached();
        this.syncInput();
    }

    private setText(component: number | undefined, text: string): void {
        if (component === undefined) {
            return;
        }
        const widget = this.widget(component);
        if (!widget || widget.text === text) {
            return;
        }
        widget.text = text;
        markWidgetInteractionDirty(widget);
        this.deps.widgetManager.invalidateWidgetRender(widget);
    }

    private syncInput(): void {
        const search = this.declaration?.search;
        if (!search) {
            return;
        }
        const caret = search.caret ?? "";
        const template = search.textTemplate ?? "%s";
        const text =
            this.query.length === 0
                ? this.focused
                    ? caret
                    : search.placeholder ?? ""
                : template.replace("%s", sanitize(this.query)) + (this.focused ? caret : "");
        this.setText(search.inputComponent, text);

        const background = this.widget(search.backgroundComponent ?? -1);
        if (background) {
            const color = this.focused
                ? search.focusColor ?? background.color
                : search.blurColor ?? background.color;
            background.color = color;
            background.mouseOverColor = this.focused
                ? search.focusColor ?? color
                : search.blurHoverColor ?? color;
            markWidgetInteractionDirty(background);
            this.deps.widgetManager.invalidateWidgetRender(background);
        }
    }

    private applyHint(): void {
        const hint = this.declaration?.hint;
        if (hint) {
            this.setText(hint.component, hint.text);
        }
    }

    private scheduleFetch(resetScroll = true): void {
        const search = this.declaration?.search;
        if (!search) {
            return;
        }
        if (this.fetchTimer) {
            clearTimeout(this.fetchTimer);
        }
        const query = this.query;
        if (search.dataComponent !== undefined) {
            this.rows = filterRows(this.sourceRows, query);
            this.total = this.rows.filter((row) => !row.header).length;
            this.version++;
            this.renderRows(resetScroll);
            return;
        }
        if (query.trim().length === 0) {
            this.rows = [];
            this.total = 0;
            this.fetchState = "idle";
            this.version++;
            this.renderRows(true);
            return;
        }
        this.fetchTimer = setTimeout(
            () => void this.fetchRows(query),
            search.debounceMs ?? DEFAULT_DEBOUNCE_MS,
        );
    }

    private async fetchRows(query: string): Promise<void> {
        const search = this.declaration?.search;
        if (!search?.endpoint) {
            return;
        }
        const sequence = ++this.fetchSequence;
        const url = `${search.endpoint}?${search.queryParam ?? "q"}=${encodeURIComponent(
            query,
        )}&limit=${search.limit ?? DEFAULT_LIMIT}`;
        this.fetchState = "loading";
        this.applyStatus();
        try {
            const payload = (await this.deps.fetchContent(url)) as { total?: number; rows?: unknown[] };
            // A slower earlier request must not overwrite a newer one's results.
            if (sequence !== this.fetchSequence || query !== this.query) {
                return;
            }
            this.fetchState = "idle";
            this.rows = Array.isArray(payload.rows)
                ? (payload.rows as any[])
                      .map((row) => ({ id: row?.id | 0, name: String(row?.name ?? "") }))
                      .filter((row) => row.id > 0)
                : [];
            this.total = (payload.total ?? 0) | 0 || this.rows.length;
            this.version++;
            this.renderRows(true);
        } catch (error) {
            if (sequence !== this.fetchSequence || query !== this.query) {
                return;
            }
            console.warn("[custom-interface] content fetch failed", error);
            this.fetchState = "error";
            this.rows = [];
            this.total = 0;
            this.version++;
            this.renderRows(true);
        }
    }

    private renderRows(resetScroll: boolean): void {
        const declaration = this.declaration;
        if (!declaration || !this.isAttached()) {
            return;
        }
        this.applyStatus();

        const list = declaration.list;
        const view = list ? this.widget(list.viewComponent) : undefined;
        if (!list || !view) {
            return;
        }

        const totalRows = Math.max(1, Math.ceil(this.rows.length / Math.max(1, list.columns)));
        const viewHeight = Math.max(0, view.height | 0);
        const scrollHeight = Math.max(viewHeight, totalRows * list.rowHeight);
        view.scrollWidth = Math.max(0, view.width | 0);
        view.scrollHeight = scrollHeight;
        const maxScrollY = Math.max(0, scrollHeight - viewHeight);
        view.scrollY = resetScroll ? 0 : Math.min(Math.max(0, view.scrollY | 0), maxScrollY);

        this.visibleStartRow = -1;
        this.renderedVersion = -1;
        this.refreshVisibleSlots(true);
        this.refreshScrollbar();
        this.deps.widgetManager.invalidateWidget(view, "custom-interface-results");
    }

    private applyStatus(): void {
        const status = this.declaration?.status;
        if (!status) {
            return;
        }

        if (this.fetchState === "error" && status.error) {
            this.setText(status.component, status.error);
            return;
        }
        if (this.fetchState === "loading" && status.loading) {
            this.setText(status.component, status.loading);
            return;
        }
        if (this.query.trim().length === 0 && this.declaration?.search?.dataComponent === undefined) {
            this.setText(status.component, status.idle ?? "");
            return;
        }

        const shown = this.rows.length;
        if (shown === 0) {
            this.setText(status.component, status.empty ?? "");
            return;
        }
        const template = this.total > shown ? status.truncated ?? status.matches ?? "" : status.matches ?? "";
        const text = template.replace("%shown", String(shown)).replace("%total", String(this.total));
        this.setText(status.component, text);
    }

    private refreshVisibleSlots(force = false): void {
        const list = this.declaration?.list;
        const view = list ? this.widget(list.viewComponent) : undefined;
        if (!list || !view) {
            return;
        }

        const startRow = Math.max(0, Math.floor(Math.max(0, view.scrollY | 0) / list.rowHeight));
        if (!force && startRow === this.visibleStartRow && this.renderedVersion === this.version) {
            return;
        }
        this.visibleStartRow = startRow;
        this.renderedVersion = this.version;

        const label = list.itemLabel ?? "";
        const headerLabel = list.headerLabel ?? "%name";
        for (let slot = 0; slot < list.slotCount; slot++) {
            const poolRow = Math.floor(slot / list.columns);
            const column = slot % list.columns;
            const resultRow = startRow + poolRow;
            const row = this.rows[resultRow * list.columns + column];
            const background = this.widget(list.backgroundStart + slot);
            const icon = this.widget(list.iconStart + slot);
            const text = list.labelStart === undefined ? icon : this.widget(list.labelStart + slot);
            if (!background || !icon || !text) {
                continue;
            }
            this.slotRows[slot] = row;

            const backgroundY = (list.backgroundBaseY ?? 0) + resultRow * list.rowHeight;
            const iconY = (list.iconBaseY ?? 0) + resultRow * list.rowHeight;
            background.rawY = backgroundY;
            background.y = backgroundY;
            icon.rawY = iconY;
            icon.y = iconY;
            if (text !== icon) {
                const labelY = (list.labelBaseY ?? 0) + resultRow * list.rowHeight;
                text.rawY = labelY;
                text.y = labelY;
            }

            const hidden = !row;
            background.hidden = hidden || !!row?.header;
            background.isHidden = background.hidden;
            icon.hidden = hidden;
            icon.isHidden = hidden;
            text.hidden = hidden;
            text.isHidden = hidden;

            const itemId = !row || row.header
                ? -1
                : text !== icon
                  ? row.icon ?? -1
                  : list.textOnly
                    ? -1
                    : row.id | 0;
            icon.itemId = itemId;
            icon.itemQuantity = itemId >= 0 ? 1 : 0;
            icon.itemAmount = itemId >= 0 ? 1 : 0;
            if (text !== icon) {
                icon.hidden = hidden || itemId < 0;
                icon.isHidden = icon.hidden;
            }
            text.text = !row
                ? ""
                : (row.header ? headerLabel : label)
                      .replace("%name", sanitize(row.name))
                      .replace("%id", String(row.id | 0))
                      .replace("%detail", sanitize(row.detail));
            if (list.clickable) {
                // A header is a title, not a destination: it offers no ops.
                if (!this.labelActions.has(slot)) this.labelActions.set(slot, text.actions);
                text.actions = row?.header ? [] : this.labelActions.get(slot);
            }

            markWidgetInteractionDirty(background);
            markWidgetInteractionDirty(icon);
            this.deps.widgetManager.invalidateWidgetRender(background);
            this.deps.widgetManager.invalidateWidgetRender(icon);
            if (text !== icon) {
                markWidgetInteractionDirty(text);
                this.deps.widgetManager.invalidateWidgetRender(text);
            }
        }

        this.deps.widgetManager.invalidateScroll(view);
    }

    private resolveScrollbarGraphicId(token: string): number {
        let spriteIndex: { getArchiveId?: (token: string) => number } | undefined;
        try {
            spriteIndex = this.deps.getCacheSystem()?.getIndex?.(IndexType.DAT2.sprites);
        } catch {
            spriteIndex = undefined;
        }
        if (!spriteIndex) {
            return -1;
        }
        const rawToken = String(token ?? "").trim();
        if (rawToken.length === 0) {
            return -1;
        }
        const directArchiveId = spriteIndex.getArchiveId?.(rawToken);
        if (typeof directArchiveId === "number" && directArchiveId >= 0) {
            return directArchiveId | 0;
        }
        let archiveToken = rawToken;
        let frameIndex = 0;
        const commaIndex = rawToken.lastIndexOf(",");
        if (commaIndex >= 0 && commaIndex < rawToken.length - 1) {
            const candidateFrame = Number.parseInt(rawToken.slice(commaIndex + 1), 10);
            if (Number.isFinite(candidateFrame) && candidateFrame >= 0) {
                archiveToken = rawToken.slice(0, commaIndex);
                frameIndex = candidateFrame | 0;
            }
        }
        const archiveId = spriteIndex.getArchiveId?.(archiveToken);
        if (typeof archiveId !== "number" || archiveId < 0) {
            return -1;
        }
        return ((archiveId & 0xffff) << 16) | (frameIndex & 0xffff);
    }

    /** Applies the scroll height every declared scrolling container needs. */
    private applyScrollRegions(): void {
        for (const region of this.declaration?.scroll ?? []) {
            const view = this.widget(region.viewComponent);
            if (!view) {
                continue;
            }
            if (region.contentHeight !== undefined) {
                view.scrollWidth = Math.max(0, view.width | 0);
                view.scrollHeight = Math.max(view.height | 0, region.contentHeight | 0);
            }
            this.initializeScrollView(region.viewComponent, region.scrollbarComponent);
            this.refreshScrollbar(region.viewComponent, region.scrollbarComponent);
        }
    }

    private initializeScrollView(viewComponent?: number, scrollbarComponent?: number): void {
        const list = this.declaration?.list;
        const viewId = viewComponent ?? list?.viewComponent;
        const scrollbarId = scrollbarComponent ?? list?.scrollbarComponent;
        if (viewId === undefined || scrollbarId === undefined) {
            return;
        }
        const view = this.widget(viewId);
        const scrollbar = this.widget(scrollbarId);
        if (!view || !scrollbar) {
            return;
        }

        scrollbar.scrollBarTargetUid = view.uid | 0;
        scrollbar.scrollBarAxis = "y";

        const hasScrollbarChildren =
            Array.isArray(scrollbar.children) && scrollbar.children.length >= 6;
        if (!hasScrollbarChildren) {
            const graphicIds = SCROLLBAR_GRAPHICS.map((token) =>
                this.resolveScrollbarGraphicId(token),
            );
            if (graphicIds.some((id) => id < 0)) {
                return;
            }
            this.deps.runWidgetScopedClientScript(
                scrollbar.uid | 0,
                SCROLLBAR_INIT_SCRIPT_ID,
                [scrollbar.uid | 0, view.uid | 0, ...graphicIds],
                "run_script",
            );
        }
        this.deps.widgetManager.invalidateWidget(scrollbar, "custom-interface-scrollbar-init");
    }

    private refreshScrollbar(viewComponent?: number, scrollbarComponent?: number): void {
        const list = this.declaration?.list;
        const viewId = viewComponent ?? list?.viewComponent;
        const scrollbarId = scrollbarComponent ?? list?.scrollbarComponent;
        if (viewId === undefined || scrollbarId === undefined) {
            return;
        }
        const view = this.widget(viewId);
        const scrollbar = this.widget(scrollbarId);
        if (!view || !scrollbar) {
            return;
        }
        this.initializeScrollView(viewId, scrollbarId);
        const state = `${view.width | 0}:${view.height | 0}:${view.scrollHeight | 0}:${view.scrollY | 0}`;
        if (this.scrollbarState.get(scrollbar.uid | 0) === state) {
            return;
        }
        this.scrollbarState.set(scrollbar.uid | 0, state);
        this.deps.runWidgetScopedClientScript(
            scrollbar.uid | 0,
            SCROLLBAR_RESIZE_SCRIPT_ID,
            [scrollbar.uid | 0, view.uid | 0, view.scrollY | 0],
            "run_script",
        );
        this.deps.widgetManager.invalidateWidget(scrollbar, "custom-interface-scrollbar-resize");
    }
}
