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
        /** "%name" and "%id" are replaced per row. */
        itemLabel?: string;
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
};

export type CustomInterfaceRow = { id: number; name: string };

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
        if (search?.dataComponent !== undefined && uid === this.uid(search.dataComponent)) {
            try {
                const rows = JSON.parse(text);
                this.sourceRows = Array.isArray(rows)
                    ? rows.filter((row) => Number.isInteger(row?.id) && row.id > 0 && typeof row.name === "string")
                    : [];
            } catch {
                this.sourceRows = [];
            }
            this.scheduleFetch();
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

    private scheduleFetch(): void {
        const search = this.declaration?.search;
        if (!search) {
            return;
        }
        if (this.fetchTimer) {
            clearTimeout(this.fetchTimer);
        }
        const query = this.query;
        if (search.dataComponent !== undefined) {
            const term = query.trim().toLowerCase();
            this.rows = this.sourceRows.filter((row) => row.name.toLowerCase().includes(term));
            this.total = this.rows.length;
            this.version++;
            this.renderRows(true);
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
        for (let slot = 0; slot < list.slotCount; slot++) {
            const poolRow = Math.floor(slot / list.columns);
            const column = slot % list.columns;
            const resultRow = startRow + poolRow;
            const row = this.rows[resultRow * list.columns + column];
            const background = this.widget(list.backgroundStart + slot);
            const icon = this.widget(list.iconStart + slot);
            if (!background || !icon) {
                continue;
            }

            const backgroundY = (list.backgroundBaseY ?? 0) + resultRow * list.rowHeight;
            const iconY = (list.iconBaseY ?? 0) + resultRow * list.rowHeight;
            background.rawY = backgroundY;
            background.y = backgroundY;
            icon.rawY = iconY;
            icon.y = iconY;

            const hidden = !row;
            background.hidden = hidden;
            background.isHidden = hidden;
            icon.hidden = hidden;
            icon.isHidden = hidden;

            if (row) {
                icon.itemId = list.textOnly ? -1 : row.id | 0;
                icon.itemQuantity = list.textOnly ? 0 : 1;
                icon.itemAmount = list.textOnly ? 0 : 1;
                icon.text = label
                    .replace("%name", sanitize(row.name))
                    .replace("%id", String(row.id | 0));
            } else {
                icon.itemId = -1;
                icon.itemQuantity = 0;
                icon.itemAmount = 0;
                icon.text = "";
            }

            markWidgetInteractionDirty(background);
            markWidgetInteractionDirty(icon);
            this.deps.widgetManager.invalidateWidgetRender(background);
            this.deps.widgetManager.invalidateWidgetRender(icon);
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
