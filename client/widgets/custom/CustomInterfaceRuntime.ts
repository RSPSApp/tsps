import { getCustomInterface } from "../../common/gamemode/GamemodeContentStore";
import { IndexType } from "../../rs/cache/IndexType";
import { markWidgetInteractionDirty } from "../WidgetInteraction";
import type { WidgetManager } from "../WidgetManager";
import { sendWidgetAction, sendWidgetActionMessage } from "../../network/ServerConnection";
import { tooltipManager, type Tooltip } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { collectInputWidgetsAtPoint } from "../../game/widgets/interaction/widgetClickProbe";
import { layoutCards, type CardPlacement, type CardStyle } from './cardLayout';
import { CardGroupBackdropPool, type CardGroupBackdrop } from './cardGroupBackdrops';

type CardPart = { start: number; x: number; y: number; width: number; height: number;
    stretch?: boolean; align?: 'center' | 'right'; textTemplate?: string; singleLine?: boolean;
    fontId?: number; textColor?: number; textAlignment?: number };
const ROW_PRIMARY_OP = 1, ROW_INFO_OP = 2, ROW_EXAMINE_OP = 3;

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
    /**
     * A non-modal panel (mounted beside other interfaces, e.g. in a viewport overlay layer). It
     * keeps no search or list state, so opening it leaves the open modal's state alone; only
     * `hotkeys` and `dockBesideSidePanel` apply to it. (A hover preview needs no client code:
     * a widget's `onMouseOver`/`onMouseLeave` can run cache script 69, `if_sethide`.)
     */
    overlay?: boolean;
    /** A key (`event.key`, e.g. "F1") clicks a visible component's op 1, while `gate` (if any) is visible. */
    hotkeys?: { gate?: number; keys: Array<{ key: string; component: number }> };
    /**
     * On the resizable frames, the overlay's root (a right-anchored layer, `xPositionMode` 2)
     * moves so its right edge touches the side panel's left edge. The fixed frame keeps `rawX`.
     */
    dockBesideSidePanel?: boolean;
    /** Retain public browser state while another custom interface is open. */
    preserveState?: boolean;
    search?: {
        /** Text component the typed query is rendered into. */
        inputComponent: number;
        /** Optional box behind the input, recoloured while focused. */
        backgroundComponent?: number;
        /** Components that take focus when clicked; defaults to the input and its box. */
        focusComponents?: number[];
        maxLength?: number;
        exactNumericTerms?: boolean;
        /** Shown when the query is empty and the box is not focused. */
        placeholder?: string;
        /** False leaves the field unfocused (showing its placeholder) until it is clicked. */
        focusOnOpen?: boolean;
        /** Focus a newly opened search view, without taking focus back on data refreshes. */
        focusOnTabs?: number[];
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
        /** Private live search over the authenticated widget-action socket. Responses are
         * { session, sequence, query, rows, total?, offset?, pageSize? }; stale responses are ignored.
         * pageSize enables a bounded, scroll-driven cache for flat result lists. */
        socket?: { requestComponent: number; responseComponent: number; sessionComponent: number;
            tabs?: number[]; minimumLength?: number; allowNumeric?: boolean; idle?: string; pageSize?: number; retainedPages?: number };
    };
    list?: {
        viewComponent: number;
        scrollbarComponent?: number;
        slotCount: number;
        columns: number;
        rowHeight: number;
        /** Responsive native cards. Sections are bands; groups can opt into tiles too. */
        cards?: CardStyle & { parts: CardPart[]; groupParts?: CardPart[] };
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
        labelXWithoutIcon?: number;
        /** Additional text columns filled from trusted server-authored row.panel fields. */
        textColumns?: { start: number; field: string; baseY?: number; indent?: boolean;
            header?: { baseY: number; x: number; width: number; height: number } }[];
        /** "%name", "%id" and "%detail" are replaced per row. */
        itemLabel?: string;
        /**
         * A second text component per slot, drawn over the label in its own font (a bold name
         * over a plain description): `detailStart + slot`, filled from `detailLabel` the way
         * `itemLabel` fills the label, and moved with the row.
         */
        detailStart?: number;
        detailLabel?: string;
        /** Row fills by the row's place in the list, not its slot: [even, odd], a zebra list. */
        stripeColors?: [number, number];
        /** More components per slot (`start + slot`) that move and hide with the row: lines, bevels. */
        rowParts?: number[];
        /** The label of a header row; "%name" is replaced. */
        headerLabel?: string;
        /** Optional single-column tree groups, toggled entirely on the client. */
        collapsible?: boolean;
        searchExpandsGroups?: boolean;
        groupLabel?: string;
        groupHeight?: number;
        groupColor?: number;
        leafActions?: string[];
        /** Op 1 expands locally; declared additional group operations go to the server. */
        groupActions?: string[];
        /** Optional native pooled controls. Component ranges each contain slotCount widgets. */
        rowChrome?: { borderStart: number; dividerStart: number; guideStart: number;
            toggleStart: number; toggleGlyphStart: number; indent: number; maxIndent?: number };
        headerStyle?: { height: number; backgroundColor: number; fontId?: number;
            textColor?: number; labelX?: number; labelWidth?: number; labelHeight?: number; labelY?: number };
        /** Clicking a row sends its id to the server as the action's slot. */
        clickable?: boolean;
        /** Additional per-row controls. Each start spans slotCount pooled components. */
        rowActions?: Array<{ start: number; leafOnly?: boolean; groupOnly?: boolean;
            label?: string; groupLabel?: string; expandedLabel?: string }>;
        /** Do not bind NPC models beyond the visible cards plus this pixel buffer. */
        overscan?: number;
        /** Full row explanation served by the existing native TooltipOverlay. */
        tooltipField?: string;
        /** Local row ops: op 2 displays a nonempty panel field; op 3 uses the host's item examine. */
        actions?: { examine?: boolean; info?: { label: string; field: string } };
        /**
         * Shows a clicked row's details at once, without waiting a tick for the server: each
         * `texts` component takes the row's `panel` value of that name, `iconComponent` takes
         * its icon, and `showComponents` appear. Only the `op` click selects (default op 1).
         */
        select?: {
            op?: number;
            /** Handle details on the client without transmitting a widget action. */
            local?: boolean;
            /** Clear selected details when a new local filter is typed. Default preserves legacy panels. */
            clearOnQuery?: boolean;
            backgroundColor?: number;
            emptyComponent?: number;
            texts?: Record<string, number>;
            iconComponent?: number;
            /** Manage preview visibility from the selected row. Omitted for legacy server-controlled visibility. */
            autoHideIcon?: boolean;
            showComponents?: number[];
            /** Show each named action only while the selected row supplies its label. */
            actionComponents?: Array<{ field: string; components: number[] }>;
            /** Hide these controls when a new query clears the selection. */
            clearComponents?: number[];
        };
        /** Text lists have no inventory item associated with each row. */
        textOnly?: boolean;
        /**
         * The right-click menu names a row by its `name` ("Buy Shark") rather than by its
         * label text, for lists whose label shows something else (a shop slot showing its price).
         */
        nameTarget?: boolean;
        /**
         * In a grid, a header takes a whole row of its own: its title is centred across the
         * view in this font and colour, over a line of `lineColor`.
         */
        headerSpan?: { fontId?: number; color?: number; lineColor?: number; height?: number; fillColor?: number };
        /** Buttons that scroll the list to its sections: the nth one to the nth header. */
        jumpComponents?: number[];
        /**
         * Lights the clicked jump button at once instead of a tick later, when the server's
         * own update lands: the nth plate is shown and the others hidden, and the nth
         * button's text is wrapped in `textTemplate` (`%s` is the plain text).
         */
        jumpLit?: { components: number[]; textTemplate?: string };
        /** A jump button clears the typed query first, so it jumps within the whole list. */
        jumpClearsQuery?: boolean;
    };
    /**
     * Containers that scroll their own children. The rows are part of the definition, so
     * the client only has to give the view a scroll height and wire up a scrollbar.
     */
    scroll?: Array<{
        viewComponent: number;
        scrollbarComponent?: number;
        contentHeight?: number;
        /** Hidden text component containing the current content height in pixels. */
        contentHeightComponent?: number;
        /** Buttons that reset this container to its first row without consuming the click. */
        resetOnComponents?: number[];
    }>;
    status?: {
        component: number;
        tooltipComponent?: number;
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
        activeColor?: number;
        inactiveColor?: number;
        activeLabelIndices?: Record<number, number>;
        layoutComponent: number;
        clearQuery?: boolean;
        /** Wait for an authoritative layout commit before showing the next view. */
        serverDriven?: boolean;
        /** Content masked while a server-driven tab's rows and widget state arrive. */
        pendingComponents?: number[];
        /** Visibility of static tab content, applied locally on the same click. */
        visibility?: Array<{ component: number; tabs: number[] }>;
        /** Restore a base layout on every tab switch, then apply the active tab's overrides. */
        geometry?: Array<{ component: number; base: { rawX?: number; rawY?: number; rawWidth?: number; rawHeight?: number };
            overrides: Record<number, { rawX?: number; rawY?: number; rawWidth?: number; rawHeight?: number }> }>;
    };
};

export type CustomInterfaceRow = {
    id: number;
    name: string;
    /** Item shown in the row's icon slot, for lists with separate labels. */
    icon?: number;
    /** Optional cache NPC body preview in the list's icon and selection preview. */
    npc?: number;
    animation?: number;
    /** Override the examine target; -1 means a representative thumbnail, not a single item. */
    examineId?: number;
    /** Plain text for the label's "%detail". */
    detail?: string;
    /** Extra words the search matches, never shown. */
    terms?: string;
    /** A section title: not clickable, and kept only while a row under it matches. */
    header?: boolean;
    /** Shown only while a query is typed: a search reaches it, browsing does not. */
    searchOnly?: boolean;
    parentId?: number;
    expandable?: boolean;
    collapsed?: boolean;
    /** Text for the declared select panel, by name; server markup is kept. */
    panel?: Record<string, string>;
};

function toRow(row: any): CustomInterfaceRow {
    return {
        id: row.id | 0,
        name: String(row.name ?? ""),
        icon: Number.isInteger(row.icon) ? row.icon : undefined,
        npc: Number.isInteger(row.npc) && row.npc >= 0 ? row.npc : undefined,
        animation: Number.isInteger(row.animation) ? row.animation : undefined,
        examineId: Number.isInteger(row.examineId) ? row.examineId : undefined,
        detail: typeof row.detail === "string" ? row.detail : undefined,
        terms: typeof row.terms === "string" ? row.terms : undefined,
        header: row.header === true,
        searchOnly: row.searchOnly === true || undefined,
        parentId: Number.isInteger(row.parentId) && row.parentId > 0 ? row.parentId : undefined,
        expandable: row.expandable === true,
        collapsed: row.collapsed === true,
        panel: row.panel && typeof row.panel === "object"
            ? Object.fromEntries(
                  Object.entries(row.panel).filter(([, value]) => typeof value === "string"),
              ) as Record<string, string>
            : undefined,
    };
}

/** Rows matching the query, with each header kept only while a row under it matches. */
export function filterRows(rows: CustomInterfaceRow[], query: string,
    expansion?: ReadonlyMap<number, boolean>, revealAll = false, expandSearch = true): CustomInterfaceRow[] {
    const term = query.trim().toLowerCase();
    const byId = new Map(rows.map(row => [row.id, row]));
    const sections = new Map<number, string>();
    let section = '';
    for (const row of rows) {
        if (row.header) section = row.name;
        else sections.set(row.id, section);
    }
    const parents = new Map<number, CustomInterfaceRow[]>();
    for (const row of rows) {
        const chain: CustomInterfaceRow[] = [];
        const seen = new Set([row.id]);
        let id = row.parentId;
        while (id !== undefined && chain.length < 12 && !seen.has(id)) {
            seen.add(id);
            const parent = byId.get(id);
            if (!parent?.expandable) break;
            chain.push(parent);
            id = parent.parentId;
        }
        // Ignore malformed/cyclic/orphaned ancestry, including multipart data not yet complete.
        if (id === undefined) parents.set(row.id, chain);
    }
    const matching = new Set<number>();
    for (const row of rows) {
        if (row.header || row.expandable || !parents.has(row.id)) continue;
        const chain = parents.get(row.id)!;
        const text = `${sections.get(row.id) ?? ''} ${[row, ...chain].map(item => `${item.name} ${item.terms ?? ''} ${item.panel?.info ?? ''}`).join(' ')}`.toLowerCase();
        if (!text.includes(term)) continue;
        matching.add(row.id);
        chain.forEach(parent => matching.add(parent.id));
    }
    const result: CustomInterfaceRow[] = [];
    let header: CustomInterfaceRow | undefined;
    for (const row of rows) {
        if (row.header) {
            header = row;
            continue;
        }
        if (row.searchOnly && !term) continue;
        if (!matching.has(row.id)) continue;
        if (!revealAll && !(term && expandSearch) && parents.get(row.id)?.some(parent => !(expansion?.get(parent.id) ?? !parent.collapsed))) continue;
        if (header) {
            result.push(header);
            header = undefined;
        }
        result.push(row);
    }
    return result;
}

/**
 * Gives each header a grid row of its own: the row before it is filled out with blanks, and
 * blanks follow the header. A blank is a header with no name.
 */
export function spanHeaders(rows: CustomInterfaceRow[], columns: number): CustomInterfaceRow[] {
    const blank: CustomInterfaceRow = { id: 0, name: "", header: true };
    const result: CustomInterfaceRow[] = [];
    for (const row of rows) {
        if (row.header) {
            while (result.length % columns) result.push(blank);
            result.push(row);
            while (result.length % columns) result.push(blank);
        } else {
            result.push(row);
        }
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
    /** Sends a hotkey's click; defaults to the server connection. */
    sendWidgetAction?: typeof sendWidgetAction;
    sendWidgetActionMessage?: typeof sendWidgetActionMessage;
    getPointer?: () => { x: number; y: number } | undefined;
    examineItem?: (itemId: number) => void;
    showInfo?: (text: string) => void;
};

function sanitize(value: string | undefined): string {
    return String(value ?? "").replace(/[<>]/g, "");
}

/** What the server sent an interface, and the player's place in it, kept over a re-mount. */
type SocketSearchResult = { query: string; rows: CustomInterfaceRow[]; total: number; pages?: Map<number,CustomInterfaceRow[]> };

type ParkedInterfaceState = {
    focused: boolean;
    query: string;
    dataParts: CustomInterfaceRow[][];
    tabLayouts: Array<Array<number | { header: string }>>;
    activeTab: number;
    selectedRowId: number | undefined;
    labelActions: Map<number, unknown>;
    expansion: Map<number, boolean>;
    scrollY?: number;
    socketSession: string;
    socketSequence: number;
    socketResult?: SocketSearchResult;
};

export class CustomInterfaceRuntime {
    private readonly previewModels = new WeakMap<object, Record<string, unknown>>();
    private declaration?: CustomInterfaceDeclaration;
    private focused = false;
    private query = "";
    private rows: CustomInterfaceRow[] = [];
    private sourceRows: CustomInterfaceRow[] = [];
    private total = 0;
    private renderedVersion = -1;
    private version = 0;
    private visibleStartRow = -1;
    private listSize = "";
    private rowOffsets: number[] = [];
    private cardPlacements: CardPlacement[] = [];
    private cardGroupBackdrops: CardGroupBackdrop[] = [];
    private readonly cardGroupBackdropPool = new CardGroupBackdropPool();
    private expansion = new Map<number, boolean>();
    private rowStyleDefaults = new WeakMap<object, Record<string, unknown>>();
    /** Row shown in each list slot, for clickable lists. */
    private slotRows: (CustomInterfaceRow | undefined)[] = [];
    private labelActions = new Map<number, unknown>();
    /** The label's and background's own shape, for when a spanning header leaves the slot. */
    private slotShapes = new WeakMap<object, Array<Record<string, any>>>();
    /** Each row part's own y inside its row, read once from the definition. */
    private rowPartOffsets = new WeakMap<object, number>();
    private selectedRowId: number | undefined;
    private catalog = new Map<number, CustomInterfaceRow>();
    private dataParts: CustomInterfaceRow[][] = [];
    private tabLayouts: Array<Array<number | { header: string }>> = [];
    private activeTab = 0;
    private pendingTab?: number;
    private pendingVisibility = new Map<number, boolean>();
    private scrollbarState = new Map<number, string>();
    private fetchTimer: ReturnType<typeof setTimeout> | undefined;
    private fetchSequence = 0;
    private fetchState: "idle" | "loading" | "error" = "idle";
    private socketSession = "";
    private socketSequence = 0;
    private socketPagesPending = new Set<number>();
    private socketResult?: SocketSearchResult;
    /**
     * The last closed interface, until the next one opens. A root change (Play on the welcome
     * screen) closes every interface and mounts it again, and the server sends nothing again:
     * that re-mount takes this back instead of starting empty.
     */
    private readonly retained = new Map<number, ParkedInterfaceState>();
    private parked?: { groupId: number; state: ParkedInterfaceState };
    /** Open overlay panels by group. */
    private overlays = new Map<number, { declaration: CustomInterfaceDeclaration; rawX?: number }>();

    constructor(private readonly deps: CustomInterfaceRuntimeDeps) {}

    private readonly hoverTooltip = (): Tooltip | undefined => {
        const field = this.declaration?.list?.tooltipField;
        const pointer = this.deps.getPointer?.();
        if (!field || !pointer || !this.isAttached()) return undefined;
        const hits = collectInputWidgetsAtPoint(this.deps.widgetManager, pointer.x, pointer.y);
        for (const hit of hits.reverse()) {
            if (hit.groupId !== this.declaration?.groupId) return undefined;
            const status = this.declaration?.status;
            if (status && status.component === hit.fileId && status.tooltipComponent !== undefined) {
                return { text: String(this.widget(status.tooltipComponent)?.text ?? ''), maxWidth: 420 };
            }
            const list = this.declaration!.list!;
            const starts = [list.backgroundStart, list.iconStart, list.labelStart,
                list.rowChrome?.toggleStart, list.rowChrome?.toggleGlyphStart,
                ...(list.textColumns ?? []).map(column => column.start)];
            for (const start of starts) {
                if (start === undefined) continue;
                const slot = hit.fileId - start;
                if (slot < 0 || slot >= list.slotCount) continue;
                const text = this.slotRows[slot]?.panel?.[field];
                return text ? { text, maxWidth: 420 } : undefined;
            }
        }
        return undefined;
    };

    isSearchFocused(): boolean {
        return this.focused;
    }

    /**
     * True when this group is server-declared, i.e. the runtime owns its behaviour. `remount`
     * is the same open mounted again by the client; a new open from the server starts afresh.
     */
    onInterfaceOpened(groupId: number, remount = false): boolean {
        const declaration = getCustomInterface(groupId) as CustomInterfaceDeclaration | undefined;
        if (!declaration) {
            return false;
        }
        if (declaration.overlay) {
            this.overlays.set(groupId | 0, { declaration });
            this.tickOverlays();
            return true;
        }
        const parked = remount && this.parked?.groupId === (groupId | 0) ? this.parked.state
            : declaration.preserveState ? this.retained.get(groupId | 0) : undefined;
        this.parked = undefined;
        this.reset();
        this.declaration = declaration;
        if (declaration.list?.tooltipField) tooltipManager.add(this.hoverTooltip);
        this.focused = !!declaration.search && declaration.search.focusOnOpen !== false;
        if (parked) {
            const { scrollY, ...saved } = parked;
            Object.assign(this, saved);
            this.applyData();
        }
        this.syncInput();
        this.applyHint();
        this.applyTabLabels();
        this.applyScrollRegions();
        if (parked && declaration.search) {
            // Its widgets stayed loaded, scroll position included.
            this.scheduleFetch(false);
            const view = declaration.list && this.widget(declaration.list.viewComponent);
            if (view && parked.scrollY !== undefined) {
                view.scrollY = Math.min(parked.scrollY, Math.max(0, view.scrollHeight - view.height));
                this.refreshVisibleSlots(true);
            }
            if (this.selectedRowId !== undefined) this.applySelection(this.selectedRowId);
        } else {
            this.renderRows(true);
        }
        return true;
    }

    onInterfaceClosed(groupId: number): void {
        if (this.overlays.delete(groupId | 0)) return;
        if (((this.declaration?.groupId ?? -1) | 0) === (groupId | 0)) {
            const { focused, query, dataParts, tabLayouts, activeTab, selectedRowId, labelActions, expansion,
                socketSession, socketSequence, socketResult } = this;
            const state = { focused, query, dataParts, tabLayouts, activeTab, selectedRowId, labelActions, expansion,
                socketSession, socketSequence, socketResult };
            const view = this.declaration?.list && this.widget(this.declaration.list.viewComponent);
            const snapshot = { ...state, scrollY: view?.scrollY ?? 0 };
            this.parked = { groupId: groupId | 0, state: snapshot };
            if (this.declaration?.preserveState) {
                if (this.retained.size >= 8) this.retained.delete(this.retained.keys().next().value!);
                this.retained.set(groupId | 0, snapshot);
            }
            this.reset();
        }
    }

    /** The server can drive the query too - prefill, clear, or correct it. */
    handleSetText(uid: number, text: string): boolean {
        const search = this.declaration?.search;
        const socket = search?.socket;
        if (socket && uid === this.uid(socket.sessionComponent)) {
            if (this.socketSession !== text) {
                this.socketSession = text;
                this.socketSequence = 0;
                this.socketResult = undefined;
                this.socketPagesPending.clear();
                if (this.socketSearchActive()) this.scheduleFetch();
            }
            return true;
        }
        if (socket && uid === this.uid(socket.responseComponent)) {
            let result: any;
            try { result = JSON.parse(text); } catch { return true; }
            if (!this.socketSearchActive() || !this.socketSession || result?.session !== this.socketSession
                || result.sequence !== this.socketSequence || result.query !== this.query) return true;
            const refresh = this.socketResult?.query === this.query;
            // Older hosts still send one complete result without page metadata.
            if(result.pageSize!==undefined&&result.pageSize!==socket.pageSize)return true;
            const pageSize=result.pageSize===socket.pageSize?socket.pageSize:undefined,offset=result.offset??0;
            if(pageSize&&(!Number.isSafeInteger(offset)||offset<0||offset%pageSize!==0||!this.socketPagesPending.has(offset)&&!this.socketResult?.pages?.has(offset)))return true;
            const received: CustomInterfaceRow[] = Array.isArray(result.rows) ? result.rows.filter((row: any) =>
                Number.isInteger(row?.id) && row.id > 0 && typeof row.name === "string").map(toRow) : [];
            const total=Number.isSafeInteger(result.total)&&result.total>=0?result.total:received.length;
            if(pageSize){
                this.socketPagesPending.delete(offset);
                if(received.length>pageSize||offset>total||offset+received.length>total)return true;
                const pages=refresh?this.socketResult?.pages??new Map<number,CustomInterfaceRow[]>():new Map<number,CustomInterfaceRow[]>();pages.set(offset,received);
                const previous=this.socketResult;
                const rows=previous&&refresh&&previous.total===total?previous.rows.slice():new Array<CustomInterfaceRow>(total);
                received.forEach((row,index)=>rows[offset+index]=row);
                this.socketResult={query:this.query,rows,total,pages};
            }else {this.socketPagesPending.clear();this.socketResult = { query: this.query, rows:received, total };}
            this.fetchState = result.error ? "error" : "idle";
            this.rows = this.socketResult.rows;
            this.total = this.socketResult.total;
            this.version++;
            this.renderRows(!refresh);
            if (this.selectedRowId !== undefined) this.applySelection(this.selectedRowId);
            return true;
        }
        const part = this.dataComponents().findIndex((component) => uid === this.uid(component));
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
            const sectionBefore = this.sourceRows[0];
            this.dataParts[part] = rows;
            this.applyData();
            // New data for the same list (a favourite toggled) keeps the scroll; a new query
            // starts from the top. So does a sectioned list whose first section changed: that
            // is another list, not the same one refreshed.
            const sectionNow = this.sourceRows[0];
            const otherList = !!sectionBefore?.header && !!sectionNow?.header && sectionBefore.name !== sectionNow.name;
            if (!this.socketSearchActive()) this.scheduleFetch(otherList);
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
            const previousTab = this.activeTab;
            const pending = this.pendingTab;
            if (opened) this.activeTab = layout.active;
            if (opened && tabs.serverDriven && tabs.clearQuery && previousTab !== this.activeTab) {
                this.query = "";
                this.syncInput();
            }
            if (opened && (pending === undefined || pending === this.activeTab)) this.finishTabTransition();
            this.applyTabLabels();
            for (const entry of Array.isArray(layout?.visibility) ? layout.visibility : []) {
                if (Number.isInteger(entry?.component) && typeof entry.hidden === "boolean") {
                    this.setComponentHidden(entry.component, entry.hidden);
                }
            }
            if (opened && tabs.serverDriven && previousTab !== this.activeTab && search?.focusOnTabs
                && !search.focusOnTabs.includes(this.activeTab)) this.setFocus(false);
            if (opened && this.pendingTab === undefined && (previousTab !== this.activeTab || pending !== undefined || layout?.focusSearch === true)
                && search?.focusOnTabs?.includes(this.activeTab)) this.setFocus(true);
            this.sourceRows = this.tabRows();
            if (!this.socketSearchActive() || opened) this.scheduleFetch(opened);
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
        for (const start of [list.iconStart, list.labelStart, list.backgroundStart,
            ...(list.textColumns ?? []).map(column => column.start), ...(list.rowActions ?? []).map(action => action.start)]) {
            if (start === undefined) continue;
            const slot = (childId | 0) - start;
            if (slot >= 0 && slot < list.slotCount) {
                const row = this.slotRows[slot];
                return row && !row.header ? row.id : null;
            }
        }
        return undefined;
    }

    /** A widget op was sent: a declared tab switches its list, and a jump button scrolls it, now, not a tick later. */
    handleWidgetOp(groupId: number, childId: number): void {
        const declaration = this.declaration;
        if (!declaration || (groupId | 0) !== (declaration.groupId | 0)) return;
        const jump = declaration.list?.jumpComponents?.indexOf(childId | 0) ?? -1;
        if (jump >= 0 && declaration.list?.jumpClearsQuery && this.query) {
            this.query = "";
            this.setFocus(false);
            this.syncInput();
            this.scheduleFetch(false);
        }
        this.jumpToSection(jump);
        const tabs = declaration.tabs;
        if (!tabs) return;
        const index = [tabs.components, tabs.labelComponents].reduce(
            (found, components) => (found >= 0 ? found : components.indexOf(childId | 0)),
            -1,
        );
        if (index < 0) return;
        if (declaration.list?.select?.clearComponents) this.clearSelection();
        if (tabs.serverDriven) {
            this.pendingTab = index;
            this.setFocus(false);
            if (tabs.clearQuery) {
                this.query = "";
                this.syncInput();
            }
            for (const component of tabs.pendingComponents ?? []) {
                const widget = this.widget(component);
                if (!widget) continue;
                if (!this.pendingVisibility.has(component)) this.pendingVisibility.set(component, !!(widget.hidden || widget.isHidden));
                this.writeHidden(component, true);
            }
            return;
        }
        const previousTab = this.activeTab;
        this.activeTab = index;
        this.applyTabLabels();
        this.sourceRows = this.tabRows();
        if (tabs.clearQuery) {
            this.query = "";
            this.syncInput();
        }
        this.scheduleFetch(true);
        if (previousTab !== index && declaration.search?.focusOnTabs?.includes(index)) this.setFocus(true);
    }

    /** Hold incoming visibility behind a pending view's mask until its layout commits. */
    handleSetHidden(uid: number, hidden: boolean): boolean {
        if (this.pendingTab === undefined || uid >>> 16 !== this.declaration?.groupId) return false;
        const component = uid & 0xffff;
        if (!this.pendingVisibility.has(component)) return false;
        this.pendingVisibility.set(component, hidden);
        return true;
    }

    private setComponentHidden(component: number, hidden: boolean): void {
        if (!this.handleSetHidden(this.uid(component), hidden)) this.writeHidden(component, hidden);
    }

    private writeHidden(component: number, hidden: boolean): void {
        const widget = this.widget(component);
        if (!widget || (!!widget.hidden === hidden && !!widget.isHidden === hidden)) return;
        widget.hidden = widget.isHidden = hidden;
        markWidgetInteractionDirty(widget);
        this.deps.widgetManager.invalidateWidget(widget, "custom-interface-view");
    }

    private finishTabTransition(): void {
        this.pendingTab = undefined;
        for (const [component, hidden] of this.pendingVisibility) this.writeHidden(component, hidden);
        this.pendingVisibility.clear();
    }

    private dataComponents(): number[] {
        const search = this.declaration?.search;
        return search?.dataComponent === undefined
            ? []
            : [search.dataComponent, ...(search.extraDataComponents ?? [])];
    }

    /** Every data part's rows: the catalog the tabs draw from, or else the list itself. */
    private applyData(): void {
        const rows = this.dataComponents().flatMap((_, index) => this.dataParts[index] ?? []);
        if (this.declaration?.tabs) {
            this.catalog = new Map(rows.map((row) => [row.id, row]));
            this.sourceRows = this.tabRows();
        } else {
            this.sourceRows = rows;
        }
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
        for (const entry of tabs.geometry ?? []) {
            const widget = this.widget(entry.component);
            if (!widget) continue;
            Object.assign(widget, entry.base, entry.overrides[this.activeTab]);
            this.deps.widgetManager.invalidateWidget(widget, "custom-interface-tab-layout");
        }
        tabs.labelComponents.forEach((component, index) => {
            const activeIndex = tabs.activeLabelIndices?.[this.activeTab] ?? this.activeTab;
            const plate = this.widget(tabs.components[index]);
            const color = index === activeIndex ? tabs.activeColor : tabs.inactiveColor;
            if (plate && color !== undefined) {
                plate.color = color;
                this.deps.widgetManager.invalidateWidgetRender(plate);
            }
            const template = index === activeIndex
                ? tabs.activeTemplate ?? "%s"
                : tabs.inactiveTemplate ?? "%s";
            this.setText(component, template.replace("%s", tabs.labels[index] ?? ""));
        });
        for (const entry of tabs.visibility ?? []) {
            this.setComponentHidden(entry.component, !entry.tabs.includes(this.activeTab));
        }
    }

    /** A clickable row was sent with this op: the select op shows the row's details now. */
    handleRowOp(rowId: number, opId: number): void {
        const select = this.declaration?.list?.select;
        if (!select || (opId | 0) !== (select.op ?? 1)) return;
        this.applySelection(rowId);
    }

    private applySelection(rowId: number): void {
        const select = this.declaration?.list?.select;
        const row = this.socketSearchActive() ? this.socketResult?.rows.find(row => row?.id === rowId) : this.catalog.get(rowId)
            ?? this.sourceRows.find((candidate) => candidate.id === rowId && !candidate.header);
        if (!select || !row) return;
        this.selectedRowId = rowId;
        this.setSelectionEmpty(false);
        for (const [field, component] of Object.entries(select.texts ?? {})) {
            this.setText(component, row.panel?.[field] ?? "");
        }
        const icon = select.iconComponent === undefined ? undefined : this.widget(select.iconComponent);
        if (icon) {
            this.applyRowPreview(icon, row);
            if (select.autoHideIcon) icon.hidden = icon.isHidden = row.icon === undefined && row.npc === undefined;
            markWidgetInteractionDirty(icon);
            this.deps.widgetManager.invalidateWidgetRender(icon);
        }
        for (const action of select.actionComponents ?? []) {
            for (const component of action.components) {
                const widget = this.widget(component);
                if (!widget) continue;
                widget.hidden = widget.isHidden = !row.panel?.[action.field];
                markWidgetInteractionDirty(widget);
                this.deps.widgetManager.invalidateWidget(widget, "custom-interface-action-state");
            }
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
        if (select.backgroundColor !== undefined) this.refreshVisibleSlots(true);
    }

    private setSelectionEmpty(empty: boolean): void {
        const component = this.declaration?.list?.select?.emptyComponent;
        const widget = component === undefined ? undefined : this.widget(component);
        if (widget) {
            widget.hidden = widget.isHidden = !empty;
            this.deps.widgetManager.invalidateWidgetRender(widget);
        }
    }

    private applyRowPreview(widget: any, row?: CustomInterfaceRow): void {
        const npc = row?.npc;
        if (npc !== undefined) {
            if (!this.previewModels.has(widget)) this.previewModels.set(widget, Object.fromEntries(
                ["type", "isNpcChathead", "isPlayerChathead", "npcTypeId", "modelType", "modelId"].map(key => [key, widget[key]])));
            if (widget.npcTypeId !== npc || widget.sequenceId !== row?.animation) {
                widget.modelFrame = widget.modelFrameCycle = 0;
                widget.animationId = widget.sequenceId = row?.animation ?? -1;
            }
            Object.assign(widget, { type: 6, isNpcChathead: true, isPlayerChathead: false, npcTypeId: npc, modelType: 2, modelId: npc });
        } else {
            const original = this.previewModels.get(widget);
            if (original) {
                Object.assign(widget, original); this.previewModels.delete(widget);
                widget.animationId = widget.sequenceId = -1;
                widget.modelFrame = widget.modelFrameCycle = 0;
            }
        }
        widget.itemId = row?.icon ?? -1;
        widget.itemQuantity = widget.itemAmount = widget.itemId >= 0 ? 1 : 0;
    }

    private clearSelection(): void {
        this.selectedRowId = undefined;
        this.setSelectionEmpty(true);
        const select = this.declaration?.list?.select;
        for (const component of Object.values(select?.texts ?? {})) this.setText(component, "");
        for (const component of select?.clearComponents ?? []) {
            const widget = this.widget(component);
            if (!widget) continue;
            widget.hidden = widget.isHidden = true;
            markWidgetInteractionDirty(widget);
            this.deps.widgetManager.invalidateWidget(widget, "custom-interface-clear-selection");
        }
    }

    handleWidgetClick(groupId: number, childId: number, opId = ROW_PRIMARY_OP): boolean {
        if (groupId === this.declaration?.groupId) {
            for (const region of this.declaration.scroll ?? []) {
                if (!region.resetOnComponents?.includes(childId)) continue;
                const view = this.widget(region.viewComponent);
                if (view) {
                    view.scrollY = 0;
                    this.deps.widgetManager.invalidateScroll(view);
                }
                this.refreshScrollbar(region.viewComponent, region.scrollbarComponent);
            }
            const list = this.declaration.list;
            if (list?.collapsible || list?.select?.local) {
                const starts = [list.iconStart, list.labelStart, list.backgroundStart,
                    list.rowChrome?.toggleStart, list.rowChrome?.toggleGlyphStart,
                    ...(list.rowActions ?? []).map(action => action.start),
                    ...(list.textColumns ?? []).map(column => column.start)];
                for (const start of starts) {
                    if (start === undefined) continue;
                    const slot = childId - start;
                    if (slot < 0 || slot >= list.slotCount) continue;
                    const row = this.slotRows[slot];
                    if (!row || row.header) return true;
                    this.setFocus(false);
                    if (opId === ROW_INFO_OP && list.actions?.info) {
                        const text = row.panel?.[list.actions.info.field];
                        if (text) this.deps.showInfo?.(text);
                        return true;
                    }
                    if (opId === ROW_EXAMINE_OP && list.actions?.examine) {
                        const itemId = row.examineId ?? row.icon ?? -1;
                        if (itemId >= 0) this.deps.examineItem?.(itemId);
                        return true;
                    }
                    if (opId !== ROW_PRIMARY_OP && list.actions) return true;
                    if (row.expandable && opId !== ROW_PRIMARY_OP && list.groupActions?.[opId - 1]) return false;
                    if (!row.expandable && !list.select?.local) return false;
                    if (list.select?.local) this.applySelection(row.id);
                    if (list.collapsible && row.expandable && (!this.query.trim() || list.searchExpandsGroups === false)) {
                        this.expansion.set(row.id, !(this.expansion.get(row.id) ?? !row.collapsed));
                        this.scheduleFetch(false);
                    }
                    return true;
                }
            }
        }
        return this.handleWidgetFocus(groupId, childId);
    }

    /** Update focus for any press without executing a row's action a second time. */
    handleWidgetFocus(groupId: number, childId: number): boolean {
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

    /**
     * Where each row of the list starts, and after the last one where the list ends. Rows are
     * `rowHeight` tall, except a spanning header given a height of its own.
     */
    private rowTops(): number[] {
        if (this.topsOf === this.rows) return this.tops;
        const list = this.declaration?.list;
        const columns = Math.max(1, list?.columns ?? 1);
        const rowHeight = list?.rowHeight ?? 0;
        const headerHeight = list?.headerSpan?.height ?? (columns === 1 ? list?.headerStyle?.height : undefined) ?? rowHeight;
        const tops = [0];
        for (let at = 0; at < this.rows.length; at += columns) {
            const row = this.rows[at];
            const height = row?.header ? headerHeight : columns === 1 && row?.expandable ? list?.groupHeight ?? rowHeight : rowHeight;
            tops.push(tops[tops.length - 1] + Math.max(1, height));
        }
        this.topsOf = this.rows;
        this.tops = tops;
        return tops;
    }

    private rowTop(row: number): number {
        const tops = this.rowTops();
        const last = tops.length - 1;
        return row <= last ? tops[Math.max(0, row)] : tops[last] + (row - last) * (this.declaration?.list?.rowHeight ?? 0);
    }

    /** The row drawn at this scroll position. */
    private rowAt(y: number): number {
        const tops = this.rowTops();
        let row = 0;
        while (row + 1 < tops.length - 1 && tops[row + 1] <= y) row++;
        return row;
    }

    /** Scrolls the list so its nth header is the top row. */
    private jumpToSection(section: number): void {
        const list = this.declaration?.list;
        const view = list ? this.widget(list.viewComponent) : undefined;
        if (!list || !view || section < 0) return;
        const headers = this.rows.flatMap((row, index) => (row.header && row.name ? [index] : []));
        const index = headers[section];
        if (index === undefined) return;
        this.lightJump(section);
        const top = this.rowTop(Math.floor(index / Math.max(1, list.columns)));
        view.scrollY = Math.max(0, Math.min(top, (view.scrollHeight | 0) - (view.height | 0)));
        this.deps.widgetManager.invalidateScroll(view);
        this.refreshVisibleSlots();
        this.refreshScrollbar();
    }

    private lightJump(section: number): void {
        const list = this.declaration?.list;
        const lit = list?.jumpLit;
        if (!list || !lit) return;
        lit.components.forEach((component, index) => {
            const plate = this.widget(component);
            const hidden = index !== section;
            if (plate && (!!plate.hidden !== hidden || !!plate.isHidden !== hidden)) {
                plate.hidden = hidden;
                plate.isHidden = hidden;
                this.deps.widgetManager.invalidateWidget(plate, "custom-interface-jump");
            }
            const label = lit.textTemplate ? this.widget(list.jumpComponents?.[index] ?? -1) : undefined;
            if (!label) return;
            const plain = String(label.text ?? "").replace(/<\/?col(?:=[0-9a-f]+)?>/gi, "");
            const text = hidden ? plain : lit.textTemplate!.replace("%s", plain);
            if (label.text === text) return;
            label.text = text;
            this.deps.widgetManager.invalidateWidgetRender(label);
        });
    }

    handleSearchKeyEvents(keyEvents: Array<{ keyTyped: number; keyPressed: number }>): boolean {
        const search = this.declaration?.search;
        if (!search || !this.focused || this.pendingTab !== undefined) {
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

    /**
     * A declared hotkey of an open overlay panel: sends its component's op 1 and returns true,
     * so the key does nothing else (an F-key would otherwise switch the side panel).
     */
    handleHotkey(event: KeyboardEvent): boolean {
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return false;
        const manager = this.deps.widgetManager;
        for (const [groupId, { declaration }] of this.overlays) {
            const hotkeys = declaration.hotkeys;
            const entry = hotkeys?.keys.find((candidate) => candidate.key === event.key);
            if (!hotkeys || !entry) continue;
            const at = (component: number) => manager.getWidgetByUid(((groupId & 0xffff) << 16) | (component & 0xffff));
            const gate = hotkeys.gate === undefined ? undefined : at(hotkeys.gate);
            if (hotkeys.gate !== undefined &&
                (!gate || gate.hidden || gate.isHidden || manager.isEffectivelyHidden(gate.uid))) continue;
            const target = at(entry.component);
            if (!target || target.hidden || target.isHidden || manager.isEffectivelyHidden(target.uid)) continue;
            (this.deps.sendWidgetAction ?? sendWidgetAction)({ widgetId: target.uid | 0, groupId, childId: entry.component, opId: 1 });
            return true;
        }
        return false;
    }

    /** Side panel per resizable frame (RuneLite's Viewport widgets). */
    private static readonly SIDE_PANELS: Record<number, number> = {
        161: (161 << 16) | 73, // resizable classic: ToplevelOsrsStretch.SIDE_CONTAINER
        164: (164 << 16) | 70, // resizable modern: ToplevelPreEoc.SIDE_BACKGROUND
    };

    private dockBesideSidePanel(groupId: number, overlay: { rawX?: number }): void {
        const manager = this.deps.widgetManager;
        const root = manager.getWidgetByUid((groupId & 0xffff) << 16) as any;
        if (!root) return;
        overlay.rawX ??= root.rawX | 0;
        const sideUid = CustomInterfaceRuntime.SIDE_PANELS[manager.rootInterface as number];
        const side = sideUid === undefined ? undefined : (manager.getWidgetByUid(sideUid) as any);
        const containerUid = manager.getInterfaceParentContainerUid(groupId);
        const container = containerUid == null ? undefined : (manager.getWidgetByUid(containerUid) as any);
        let rawX = overlay.rawX;
        if (side && container && !side.hidden && !side.isHidden &&
            typeof side._absLogicalX === "number" && typeof container._absLogicalX === "number") {
            // The overlay layer clips its children, so the root can't pass its right edge (164
            // ends it at the minimap column, a few pixels short of the side panel).
            rawX = Math.max(0, (container._absLogicalX + (container.width | 0)) - side._absLogicalX);
        }
        if ((root.rawX | 0) === rawX) return;
        root.rawX = rawX;
        if (container) root.x = ((container.width | 0) - (root.width | 0) - rawX) | 0;
        manager.invalidateWidget(root, "custom-interface-dock");
    }

    /** Keeps each open side panel docked. */
    private tickOverlays(): void {
        for (const [groupId, overlay] of this.overlays) {
            if (overlay.declaration.dockBesideSidePanel) this.dockBesideSidePanel(groupId, overlay);
        }
    }

    tick(): void {
        if (this.overlays.size) this.tickOverlays();
        if (!this.declaration || !this.isAttached()) {
            return;
        }
        const list = this.declaration.list;
        const view = list ? this.widget(list.viewComponent) : undefined;
        if (view) {
            this.deps.widgetManager.ensureLayout?.(view);
            const size = `${view.width},${view.height}`;
            if (size !== this.listSize) {
                this.listSize = size;
                // A taller modal exposes more rows; a narrower one changes the row widths
                // and clamps its scroll. Refresh once for each size, even without new data.
                this.renderRows(false);
            }
        }
        this.initializeScrollView();
        this.applyScrollRegions();
        this.refreshVisibleSlots();
    }

    private reset(): void {
        this.finishTabTransition();
        tooltipManager.remove(this.hoverTooltip);
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
        this.listSize = "";
        this.rowOffsets = [];
        this.cardPlacements = [];
        this.cardGroupBackdrops = [];
        this.cardGroupBackdropPool.reset();
        this.expansion = new Map();
        this.slotRows = [];
        this.selectedRowId = undefined;
        this.catalog = new Map();
        this.dataParts = [];
        this.tabLayouts = [];
        this.activeTab = 0;
        this.socketSession = "";
        this.socketSequence = 0;
        this.socketResult = undefined;
        this.socketPagesPending.clear();
        this.labelActions = new Map();
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
            this.fetchTimer = undefined;
        }
        // Invalidate HTTP results as soon as typing changes, including clearing the field.
        this.fetchSequence++;
        const query = this.query;
        if (resetScroll && this.declaration?.list?.select?.clearOnQuery && this.selectedRowId !== undefined) this.clearSelection();
        const socket = search.socket;
        if (socket) {
            if (this.socketSearchActive()) {
                if (!resetScroll && this.socketResult?.query === query) {
                    this.rows = this.socketResult.rows;
                    this.total = this.socketResult.total;
                    this.version++;
                    this.renderRows(false);
                    return;
                }
                this.socketSequence++;
                this.clearSelection();
                this.socketResult = undefined;
                this.socketPagesPending.clear();
                this.rows = [];
                this.total = 0;
                this.fetchState = this.socketQueryReady() ? "loading" : "idle";
                this.version++;
                this.renderRows(true);
                if (this.socketSession) {
                    const session = this.socketSession, sequence = this.socketSequence;
                    const groupId = this.declaration!.groupId, childId = socket.requestComponent;
                    this.fetchTimer = setTimeout(() => {
                        this.fetchTimer = undefined;
                        if (!this.isAttached() || !this.socketSearchActive() || query !== this.query
                            || session !== this.socketSession || sequence !== this.socketSequence) return;
                        if(socket.pageSize)this.socketPagesPending.add(0);
                        (this.deps.sendWidgetActionMessage ?? sendWidgetActionMessage)({
                            widgetId: this.uid(childId), groupId, childId, opId: 1,
                            target: JSON.stringify({ session, sequence, query, ...(socket.pageSize?{offset:0}:{}) }),
                        });
                    }, search.debounceMs ?? DEFAULT_DEBOUNCE_MS);
                }
                return;
            }
            this.socketSequence++;
        }
        this.fetchState = "idle";
        if (search.dataComponent !== undefined) {
            const list = this.declaration?.list;
            this.rows = search.exactNumericTerms && /^\d+$/.test(query.trim())
                ? this.sourceRows.filter(row => row.terms === query.trim())
                : filterRows(this.sourceRows, query, list?.collapsible ? this.expansion : undefined, false, list?.searchExpandsGroups !== false);
            if (list?.headerSpan) this.rows = spanHeaders(this.rows, Math.max(1, list.columns));
            this.total = search.exactNumericTerms && /^\d+$/.test(query.trim()) ? this.rows.length
                : filterRows(this.sourceRows, query, undefined, true).filter(row => !row.header && !row.expandable).length;
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

    private socketSearchActive(): boolean {
        const socket = this.declaration?.search?.socket;
        return !!socket && (!socket.tabs || socket.tabs.includes(this.activeTab));
    }

    private socketQueryReady(): boolean {
        const socket = this.declaration?.search?.socket;
        const query = this.query.trim();
        return query.length >= (socket?.minimumLength ?? 1) || !!(socket?.allowNumeric && /^\d+$/.test(query));
    }

    private loadSocketWindow(start: number): void {
        const socket=this.declaration?.search?.socket,result=this.socketResult;
        if(!socket?.pageSize||!result?.pages||!this.socketSearchActive())return;
        const size=socket.pageSize,center=Math.floor(start/size)*size,retained=Math.max(3,socket.retainedPages??3),radius=Math.floor(retained/2);
        const offsets=Array.from({length:retained},(_,i)=>center+(i-radius)*size).filter(offset=>offset>=0&&offset<result.total);
        // Only loaded nearby pages own row metadata. The sparse array preserves
        // absolute scroll positions without retaining offscreen item details.
        let evicted=false;
        for(const [offset,rows]of result.pages)if(!offsets.includes(offset)){
            result.pages.delete(offset);rows.forEach((_,i)=>delete result.rows[offset+i]);evicted=true;
        }
        if(evicted){this.rows=result.rows;this.version++;}
        for(const offset of offsets)if(!result.pages.has(offset)&&!this.socketPagesPending.has(offset)&&this.socketPagesPending.size<retained){
            this.socketPagesPending.add(offset);
            const groupId=this.declaration!.groupId,childId=socket.requestComponent;
            (this.deps.sendWidgetActionMessage??sendWidgetActionMessage)({widgetId:this.uid(childId),groupId,childId,opId:1,
                target:JSON.stringify({session:this.socketSession,sequence:this.socketSequence,query:this.query,offset})});
        }
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

    private topsOf: unknown;
    private tops: number[] = [0];

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
        this.cardPlacements = [];
        this.cardGroupBackdrops = [];
        this.rowOffsets = this.rowTops();
        const viewHeight = Math.max(0, view.height | 0);
        let contentHeight = this.rowTop(totalRows);
        if (list.cards) {
            const layout = layoutCards(this.rows, view.width, list.cards, list.headerStyle?.height ?? list.rowHeight,
                list.groupHeight ?? list.rowHeight, list.rowChrome?.indent ?? 0, list.rowChrome?.maxIndent ?? 24);
            this.cardPlacements = layout.placements;
            this.cardGroupBackdrops = layout.backdrops;
            contentHeight = layout.height;
        }
        const scrollHeight = Math.max(viewHeight, contentHeight);
        view.scrollWidth = Math.max(0, view.width | 0);
        view.scrollHeight = scrollHeight;
        const maxScrollY = Math.max(0, scrollHeight - viewHeight);
        view.scrollY = resetScroll ? 0 : Math.min(Math.max(0, view.scrollY | 0), maxScrollY);
        this.deps.widgetManager.invalidateScroll(view);

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
        if (this.socketSearchActive() && !this.socketQueryReady()) {
            this.setText(status.component, this.declaration?.search?.socket?.idle ?? status.idle ?? "");
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

        const shown = this.declaration?.list?.collapsible ? this.total : this.rows.length;
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

        const scrollY = Math.max(0, view.scrollY | 0);
        if (list.cards?.groupBackdrops) {
            this.cardGroupBackdropPool.sync(this.cardGroupBackdrops, list.cards.groupBackdrops,
                scrollY, view.height, component => this.widget(component), widget => {
                    this.deps.widgetManager.invalidateWidget(widget, 'custom-interface-card-group');
                    this.deps.widgetManager.invalidateWidgetRender(widget);
                });
        }
        let low = 0, high = list.cards ? this.cardPlacements.length : Math.max(0, this.rowOffsets.length - 2);
        while (low < high) {
            if (list.cards) {
                // Several cards share a y. Keep the first intersecting card, including a partial row.
                const mid = (low + high) >>> 1;
                const p = this.cardPlacements[mid];
                if (p.y + p.height <= scrollY) low = mid + 1;
                else high = mid;
            } else {
                const mid = (low + high + 1) >>> 1;
                if (this.rowOffsets[mid] <= scrollY) low = mid;
                else high = mid - 1;
            }
        }
        const startRow = list.cards ? low : this.rowAt(scrollY);
        this.loadSocketWindow(startRow*Math.max(1,list.columns));
        if (!force && startRow === this.visibleStartRow && this.renderedVersion === this.version) {
            return;
        }
        this.visibleStartRow = startRow;
        this.renderedVersion = this.version;

        const label = list.itemLabel ?? "";
        const headerLabel = list.headerLabel ?? "%name";
        const ancestors = list.rowChrome ? new Map(this.sourceRows.map(row => [row.id, row])) : undefined;
        const hasRowStyles = !!(list.cards || list.headerStyle || list.collapsible || list.rowChrome
            || list.textColumns?.some(column => column.header));
        for (let slot = 0; slot < list.slotCount; slot++) {
            const poolRow = list.cards ? slot : Math.floor(slot / list.columns);
            const column = slot % list.columns;
            const resultRow = startRow + poolRow;
            const found = this.rows[list.cards ? resultRow : resultRow * list.columns + column];
            // A blank beside a spanning header shows nothing.
            const placement = list.cards ? this.cardPlacements[resultRow] : undefined;
            const outside = placement && list.overscan !== undefined && placement.y > scrollY + view.height + list.overscan;
            const row = outside || (found?.header && !found.name) ? undefined : found;
            const isCard = !!placement?.card;
            const background = this.widget(list.backgroundStart + slot);
            const icon = this.widget(list.iconStart + slot);
            const text = list.labelStart === undefined ? icon : this.widget(list.labelStart + slot);
            if (!background || !icon || !text) {
                continue;
            }
            // Save the declaration's op before an empty/header slot clears its actions.
            // Otherwise first-open pooling caches [], and native clicks resolve to "Ok"
            // without an op id, so neither the server nor the details panel selects it.
            if (!this.labelActions.has(slot)) this.labelActions.set(slot, text.actions);
            this.slotRows[slot] = row;
            const chrome = list.rowChrome;
            let depth = 0, parentId = row?.parentId;
            while (parentId && depth < 12) {
                const parent = ancestors?.get(parentId);
                if (!parent?.expandable) break;
                depth++;
                parentId = parent.parentId;
            }
            const indent = chrome ? Math.min(depth * chrome.indent, chrome.maxIndent ?? 24) : 0;
            const cells = (list.textColumns ?? []).map(column => this.widget(column.start + slot));
            if (hasRowStyles) {
                for (const widget of [background, icon, text, ...cells]) {
                    if (!widget) continue;
                    if (!this.rowStyleDefaults.has(widget)) this.rowStyleDefaults.set(widget,
                        Object.fromEntries(['rawX', 'rawWidth', 'rawHeight', 'widthMode', 'heightMode', 'xPositionMode',
                            'yPositionMode', 'xTextAlignment', 'fontId', 'textColor', 'color', 'actions']
                            .map(key => [key, widget[key]])));
                    Object.assign(widget, this.rowStyleDefaults.get(widget));
                }
                if (row?.header && list.headerStyle) {
                    const style = list.headerStyle;
                    background.color = style.backgroundColor;
                    background.rawHeight = style.height;
                    text.rawX = style.labelX ?? 8;
                    text.rawWidth = style.labelWidth ?? 16;
                    text.rawHeight = style.labelHeight ?? style.height;
                    text.fontId = style.fontId ?? text.fontId;
                    text.textColor = style.textColor ?? text.textColor;
                } else if (row?.expandable) {
                    background.rawHeight = list.groupHeight ?? list.rowHeight;
                    text.rawHeight = background.rawHeight;
                    background.color = list.groupColor ?? background.color;
                }
                if (chrome && !row?.header) {
                    for (const widget of [background, icon, text]) {
                        widget.rawX += indent;
                        if (widget.widthMode === 1) widget.rawWidth += indent;
                    }
                }
                if (row && !row.header && !row.expandable && row.icon === undefined && row.npc === undefined
                    && list.labelXWithoutIcon !== undefined) {
                    text.rawX = indent + list.labelXWithoutIcon;
                    if (text.widthMode === 1) text.rawWidth = text.rawX + 8;
                }
                // Style changes include geometry. Revalidate before painting the reused slot.
                this.deps.widgetManager.invalidateWidget(text, 'custom-interface-row-style');
                this.deps.widgetManager.invalidateWidget(background, 'custom-interface-row-style');
                this.deps.widgetManager.invalidateWidget(icon, 'custom-interface-row-style');
            }

            const top = placement?.y ?? this.rowOffsets[resultRow] ?? resultRow * list.rowHeight;
            const expanded = (!!this.query.trim() && list.searchExpandsGroups !== false) || (!!row && (this.expansion.get(row.id) ?? !row.collapsed));
            const backgroundY = (list.backgroundBaseY ?? 0) + top;
            const iconY = (list.iconBaseY ?? 0) + top;
            const rowY = top;
            background.rawY = backgroundY;
            background.y = backgroundY;
            icon.rawY = iconY;
            icon.y = iconY;
            if (text !== icon) {
                const labelY = (row?.header ? list.headerStyle?.labelY ?? list.labelBaseY ?? 0 : list.labelBaseY ?? 0) + top;
                text.rawY = labelY;
                text.y = labelY;
            }

            const hidden = !row;
            background.hidden = hidden || (!!row?.header && !list.headerStyle);
            background.isHidden = background.hidden;
            icon.hidden = hidden || (text !== icon && row?.icon === undefined && row?.npc === undefined);
            icon.isHidden = icon.hidden;
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
            if (text !== icon && row?.npc !== undefined) this.applyRowPreview(icon, row);
            else if (text !== icon && icon.isNpcChathead) this.applyRowPreview(icon, row);
            if (text !== icon) {
                icon.hidden = hidden || (itemId < 0 && row?.npc === undefined) || (!!chrome && !!row?.expandable && !isCard);
                icon.isHidden = icon.hidden;
            }
            text.text = !row
                ? ""
                : (row.header ? headerLabel : row.expandable ? list.groupLabel ?? label : label)
                      .replace('%toggle', expanded ? '[-]' : '[+]')
                      .replace("%name", sanitize(row.name))
                      .replace("%id", String(row.id | 0))
                      .replace("%detail", sanitize(row.detail));
            const moved = [
                ...(list.detailStart === undefined ? [] : [this.widget(list.detailStart + slot)]),
                ...(list.rowParts ?? []).map((start) => this.widget(start + slot)),
                ...(list.rowActions ?? []).map(({ start }) => this.widget(start + slot)),
            ].filter(Boolean);
            for (const part of moved) {
                if (!this.rowPartOffsets.has(part)) this.rowPartOffsets.set(part, part.rawY | 0);
                const partY = this.rowPartOffsets.get(part)! + rowY;
                part.rawY = partY;
                part.y = partY;
                part.hidden = hidden || !!row?.header;
                part.isHidden = part.hidden;
                markWidgetInteractionDirty(part);
                this.deps.widgetManager.invalidateWidgetRender(part);
            }
            for (const action of list.rowActions ?? []) {
                const widget = this.widget(action.start + slot);
                if (!widget) continue;
                widget.hidden = widget.isHidden = hidden || !!row?.header
                    || !!action.leafOnly && !!row?.expandable || !!action.groupOnly && !row?.expandable;
                if (widget.type === 4 && (action.label !== undefined || action.groupLabel !== undefined || action.groupOnly)) {
                    widget.text = row?.expandable ? expanded && action.expandedLabel !== undefined ? action.expandedLabel
                        : action.groupLabel ?? action.label ?? (expanded ? 'Hide variants' : 'See variants') : action.label ?? '';
                }
            }
            if (list.detailStart !== undefined) {
                const detail = this.widget(list.detailStart + slot);
                if (detail) {
                    detail.text = !row || row.header
                        ? ""
                        : (list.detailLabel ?? "")
                              .replace("%name", sanitize(row.name))
                              .replace("%id", String(row.id | 0))
                              .replace("%detail", sanitize(row.detail));
                }
            }
            if (list.headerSpan && text !== icon) {
                // With a fill, the title's own background is the band and the blank beside it
                // draws the band's lines.
                const lines = list.headerSpan.fillColor !== undefined && column === 1 && !!found?.header && !found.name;
                this.styleSpanningHeader(!!row?.header, view, background, text, resultRow, lines);
            }
            if (list.stripeColors && row && !row.header && !row.expandable) {
                background.color = list.stripeColors[resultRow & 1];
            }
            if (row && row.id === this.selectedRowId && list.select?.backgroundColor !== undefined) {
                background.color = list.select.backgroundColor;
            }
            if (list.nameTarget) text.opBase = row && !row.header ? `<col=ff9040>${sanitize(row.name)}</col>` : "";
            if (list.nameTarget) for (const { start } of list.rowActions ?? []) {
                const action = this.widget(start + slot);
                if (action) action.opBase = row ? `<col=ff9040>${sanitize(row.name)}</col>` : '';
            }
            for (const column of list.textColumns ?? []) {
                const widget = this.widget(column.start + slot);
                if (!widget) continue;
                widget.rawY = widget.y = (column.baseY ?? 0) + top;
                widget.hidden = widget.isHidden = hidden || (!!row?.header && !column.header);
                // panel is also the server's formatted text source for list.select.
                widget.text = row?.panel?.[column.field] ?? "";
                if (row?.expandable) widget.text = widget.text.replace('%action', this.query.trim()
                    ? 'Search results' : expanded ? 'Click to collapse' : 'Click to expand');
                if (row?.header && column.header) {
                    widget.rawX = column.header.x;
                    widget.rawWidth = column.header.width;
                    widget.rawY = widget.y = top + column.header.baseY;
                    widget.rawHeight = column.header.height;
                } else if (chrome && column.indent) {
                    widget.rawX += indent;
                    if (widget.widthMode === 1) widget.rawWidth += indent;
                }
                if (chrome || column.header) {
                    this.deps.widgetManager.invalidateWidget(widget, 'custom-interface-row-column');
                }
                markWidgetInteractionDirty(widget);
                this.deps.widgetManager.invalidateWidgetRender(widget);
            }
            const controls = chrome ? [this.widget(chrome.toggleStart + slot), this.widget(chrome.toggleGlyphStart + slot)] : [];
            if (chrome) {
                const height = placement?.height ?? (this.rowOffsets[resultRow + 1] ?? top + list.rowHeight) - top;
                const decorations = [
                    { start: chrome.borderStart, visible: !!row?.expandable || isCard, x: indent + 1, y: 2, height: height - 4 },
                    { start: chrome.dividerStart, visible: !!row, x: indent, y: height - 1, height: 1 },
                    { start: chrome.guideStart, visible: !isCard && (!!row?.header || depth > 0), x: row?.header ? 1 : Math.max(1, indent - 3),
                        y: row?.header ? 7 : 0, height: row?.header ? height - 14 : height },
                    { start: chrome.toggleStart, visible: !!row?.expandable, x: indent + 7, y: 7, height: 22 },
                    { start: chrome.toggleGlyphStart, visible: !!row?.expandable, x: indent + 7, y: 7, height: 22 },
                ];
                for (const decoration of decorations) {
                    const widget = this.widget(decoration.start + slot);
                    if (!widget) continue;
                    widget.hidden = widget.isHidden = hidden || !decoration.visible;
                    widget.rawX = decoration.x;
                    widget.rawY = widget.y = top + decoration.y;
                    widget.rawHeight = decoration.height;
                    if (decoration.start === chrome.borderStart || decoration.start === chrome.dividerStart) widget.widthMode = 1;
                    if (widget.widthMode === 1) widget.rawWidth = decoration.x + (decoration.start === chrome.borderStart ? 1 : 0);
                    if (isCard && decoration.start === chrome.borderStart) {
                        widget.widthMode = 0;
                        widget.rawX = placement!.x + 1;
                        widget.rawWidth = placement!.width - 2;
                    }
                    if (decoration.start === chrome.guideStart) widget.rawWidth = row?.header ? 3 : 1;
                    if (decoration.start === chrome.toggleGlyphStart) widget.text = expanded ? '-' : '+';
                    this.deps.widgetManager.invalidateWidget(widget, 'custom-interface-row-control');
                    this.deps.widgetManager.invalidateWidgetRender(widget);
                }
            }
            if (isCard && list.cards && placement) {
                background.rawX = placement.x;
                background.rawWidth = placement.width;
                background.rawHeight = placement.height;
                background.widthMode = background.heightMode = background.xPositionMode = background.yPositionMode = 0;
                for (const part of [...list.cards.parts, ...(row?.expandable ? list.cards.groupParts ?? [] : [])]) {
                    const widget = this.widget(part.start + slot);
                    if (!widget) continue;
                    widget.hoverOwnerUid = background.uid;
                    const width = Math.max(1, part.stretch ? placement.width - part.width : part.width);
                    widget.widthMode = widget.heightMode = widget.xPositionMode = widget.yPositionMode = 0;
                    widget.rawWidth = width;
                    widget.rawHeight = part.height;
                    widget.rawX = placement.x + part.x + (part.align === 'center' ? Math.floor((placement.width - width) / 2)
                        : part.align === 'right' ? placement.width - width : 0);
                    widget.rawY = widget.y = top + part.y;
                    if (part.fontId !== undefined) widget.fontId = part.fontId;
                    if (part.textColor !== undefined) widget.textColor = part.textColor;
                    if (part.textAlignment !== undefined) widget.xTextAlignment = part.textAlignment;
                    if (part.singleLine) widget.text = String(widget.text ?? '').replace(/<br\s*\/?\s*>|\n/gi, ' ');
                    if (part.textTemplate && widget.text) widget.text = part.textTemplate.replace('%text', widget.text);
                    this.deps.widgetManager.invalidateWidget(widget, 'custom-interface-card-part');
                    this.deps.widgetManager.invalidateWidgetRender(widget);
                    markWidgetInteractionDirty(widget);
                }
                this.deps.widgetManager.invalidateWidget(background, 'custom-interface-card');
            }
            if (list.collapsible || list.select?.local) {
                for (const widget of [background, icon, text, ...cells, ...controls]) {
                    if (!widget) continue;
                    widget.actions = !row || row.header ? [] : row.expandable
                        ? list.groupActions ?? [this.query.trim() ? 'Details' : (this.expansion.get(row.id) ?? !row.collapsed) ? 'Collapse' : 'Expand']
                        : list.leafActions ?? (list.tooltipField && !list.select?.texts ? [] : ['Details']);
                    if (list.actions && row && !row.header) {
                        widget.actions = [row.expandable ? widget.actions[0] : null,
                            list.actions.info && row.panel?.[list.actions.info.field] ? list.actions.info.label : null,
                            list.actions.examine && (row.examineId ?? row.icon ?? -1) >= 0 ? 'Examine' : null];
                        widget.dataText = sanitize(row.name);
                    }
                    markWidgetInteractionDirty(widget);
                }
            }
            if (list.clickable && !list.collapsible && !list.select?.local) {
                // A header is a title, not a destination: it offers no ops.
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

    /**
     * A spanning header's label covers the row, centred, and its background is the line under
     * it; an item row gets the slot's own label and background shape back.
     */
    private styleSpanningHeader(header: boolean, view: any, background: any, text: any, resultRow: number, lines = false): void {
        const list = this.declaration!.list!;
        const span = list.headerSpan!;
        const fields = ["rawX", "x", "rawWidth", "width", "rawHeight", "height", "xTextAlignment", "yTextAlignment", "textColor", "color", "fontId", "opacity", "filled"] as const;
        let saved = this.slotShapes.get(text);
        if (!saved) {
            saved = [text, background].map((widget) => Object.fromEntries(fields.map((field) => [field, widget[field]])));
            this.slotShapes.set(text, saved);
        }
        Object.assign(text, saved[0]);
        Object.assign(background, saved[1]);
        if (!header && !lines) return;
        const width = view.width | 0;
        const rowHeight = span.height ?? list.rowHeight;
        // A line above and below the title: an outline wider than the view, so its sides are
        // clipped away. The list's first title sits against the top edge of the view.
        const first = resultRow === 0;
        const top = this.rowTop(resultRow) + (first ? 0 : 5);
        const band = rowHeight - (first ? 6 : 9);
        const filled = span.fillColor !== undefined && !lines;
        if (!lines) Object.assign(text, { rawY: top, y: top, rawHeight: band, height: band });
        if (!lines) Object.assign(text, {
            rawX: 0, x: 0, rawWidth: width, width, xTextAlignment: 1, yTextAlignment: 1,
            textColor: span.color ?? text.textColor, color: span.color ?? text.color, fontId: span.fontId ?? text.fontId,
        });
        Object.assign(background, {
            rawX: -1, x: -1, rawWidth: width + 2, width: width + 2, rawY: top, y: top,
            rawHeight: band, height: band, filled,
            color: filled ? span.fillColor : span.lineColor ?? 0x000000, opacity: 0, hidden: false, isHidden: false,
        });
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
            const text = region.contentHeightComponent === undefined ? undefined : this.widget(region.contentHeightComponent)?.text;
            const dynamicHeight = text?.trim() ? Number(text) : NaN;
            const contentHeight = Number.isFinite(dynamicHeight) && dynamicHeight >= 0 ? dynamicHeight : region.contentHeight;
            if (contentHeight !== undefined) {
                const scrollWidth = Math.max(0, view.width | 0);
                const scrollHeight = Math.max(view.height | 0, contentHeight | 0);
                const scrollY = Math.max(0, Math.min(view.scrollY | 0, scrollHeight - (view.height | 0)));
                if (view.scrollWidth !== scrollWidth || view.scrollHeight !== scrollHeight || view.scrollY !== scrollY) {
                    view.scrollWidth = scrollWidth;
                    view.scrollHeight = scrollHeight;
                    view.scrollY = scrollY;
                    this.deps.widgetManager.invalidateScroll(view);
                }
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
