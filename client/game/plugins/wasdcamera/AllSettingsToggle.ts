import { FLOATER_IS_SEARCHING, SETTINGS_CATEGORY } from "@runelite/api/gameval/VarbitID";
import { SETTINGS_SEARCH_STRING } from "@runelite/api/gameval/VarClientID";
import { createChild, revalidate, setAction, setHidden, WidgetType } from "../../../widgets/custom/dynamicWidgets";
import { markWidgetInteractionDirty } from "../../../widgets/WidgetInteraction";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";

/** All Settings (134): its list, as the cache's list script (3840) builds it. */
const settings = (child: number) => (134 << 16) | child;
/** The scrolling viewport, each row's drawing, each row's click area, and the scrollbar. */
const SCROLL_LAYER = settings(14);
const ROWS_LAYER = settings(19);
const CLICK_LAYER = settings(20);
const SCROLLBAR = settings(21);
/** Enum 422's Controls category (struct 914). */
export const CONTROLS_CATEGORY = 3;
/** The list's toggles (script 3849), the settings click (3945), and the scrollbar resize (72). */
export const TOGGLE_ON_SPRITE = 2848;
export const TOGGLE_OFF_SPRITE = 2847;
const CLICK_SOUND_SCRIPT = 3945;
const SCROLLBAR_RESIZE_SCRIPT = 72;
/** A row: a 6-pixel margin, its name, two description lines, a margin; the list ends 5 below it. */
const NAME_TOP = 6;
const LINE_HEIGHT = 14;
const DESCRIPTION_LINES = 2;
export const ROW_HEIGHT = NAME_TOP + LINE_HEIGHT * (1 + DESCRIPTION_LINES) + NAME_TOP;
const LIST_MARGIN = 5;
const NAME = "WASD Camera";
const DESCRIPTION = "W, A, S and D turn the camera like the arrow keys. Press Enter to chat, and Enter again to send it.";
/** What the search finds it by, as a setting struct's search terms (param 1088). */
const SEARCH_TERMS = ["wasd camera", "wasd", "camera", "keys", "keyboard", "arrow keys", "controls", "chat"];

/** What the toggle reads from the client. */
export type AllSettingsClient = {
    widgetManager?: WidgetManager;
    varManager: { getVarbit(id: number): number; getVarcString(id: number): string | undefined };
    executeScriptListener(widget: unknown, listener: unknown[]): void;
};

type Row = { background: WidgetNode; name: WidgetNode; toggle: WidgetNode; description: WidgetNode; click: WidgetNode };
type Template = Omit<Row, "click">;

/** Script 244 with event_comsubid: the hovered row's background lightens (240) and back (200). */
const EVENT_COMSUBID = -2147483643;
const hoverScript = (transparency: number) => ({ scriptId: 244, intArgs: [ROWS_LAYER, EVENT_COMSUBID, transparency, -1], objectArgs: [] });
const text = (fontId: number, colour: number) => ({
    type: WidgetType.TEXT, rawX: 10, rawWidth: 45, rawHeight: LINE_HEIGHT, xPositionMode: 0, yPositionMode: 0, widthMode: 1,
    heightMode: 0, fontId, textColor: colour, color: colour, xTextAlignment: 0, yTextAlignment: 1, lineHeight: LINE_HEIGHT,
});
/** A toggle row as script 3840 draws one, for a list with none to copy (a search that finds only this). */
const DEFAULT_ROW = {
    background: {
        type: WidgetType.RECTANGLE, rawX: 0, rawWidth: 10, xPositionMode: 1, yPositionMode: 0, widthMode: 1, heightMode: 0,
        color: 0, filled: true, transparency: 200, eventHandlers: { onMouseOver: hoverScript(240), onMouseLeave: hoverScript(200) },
    },
    name: text(496, 0xff981f),
    toggle: { type: WidgetType.GRAPHIC, rawX: 10, rawWidth: 18, rawHeight: 18, xPositionMode: 2, yPositionMode: 0, widthMode: 0, heightMode: 0 },
    description: text(495, 0x9f9f9f),
} as unknown as Template;

const childrenOf = (layer: WidgetNode): WidgetNode[] => ((layer.children ?? []) as WidgetNode[]).filter(Boolean);

/**
 * "WASD Camera" in All Settings > Controls, after the category's last row and drawn like the
 * rows the cache builds. It is the client's own setting, so clicking it sends nothing; the search
 * finds it too. Kept in place every frame, since the list is rebuilt whenever it changes.
 */
export class AllSettingsToggle {
    private row?: Row;

    constructor(
        private readonly client: AllSettingsClient,
        private readonly setting: { isEnabled(): boolean; setEnabled(enabled: boolean): void },
    ) {}

    /** Adds, moves or takes out the row to match the list. */
    sync(): void {
        const widgets = this.client.widgetManager;
        const rows = widgets?.getWidgetByUid(ROWS_LAYER);
        const clicks = widgets?.getWidgetByUid(CLICK_LAYER);
        if (!widgets || !rows || !clicks || widgets.isEffectivelyHidden(rows.uid) || !this.listed()) {
            this.remove();
            return;
        }
        if (this.row && (!childrenOf(rows).includes(this.row.background) || !childrenOf(clicks).includes(this.row.click))) {
            this.row = undefined; // the list was rebuilt
        }
        const others = childrenOf(rows).filter((child) => !this.row || !Object.values(this.row).includes(child));
        const native = this.template(others);
        // A search only this row matches: it is the result, not the cache's "Could not find" text.
        if (!native) for (const child of others) if (child.type === WidgetType.TEXT && !child.hidden) setHidden(widgets, child, true);
        const template = native ?? DEFAULT_ROW;
        const shown = others.filter((child) => !child.hidden);
        const top = Math.max(LIST_MARGIN, ...shown.map((child) => (child.y ?? child.rawY ?? 0) + (child.height ?? child.rawHeight ?? 0)));
        if (!this.row) {
            this.row = this.build(widgets, rows, clicks, template, top);
            this.refresh();
        } else if (this.row.background.rawY !== top) this.place(widgets, this.row, top);
        this.fitScroll(widgets, top + ROW_HEIGHT + LIST_MARGIN);
    }

    /** Shows the setting's state. */
    refresh(): void {
        const toggle = this.row?.toggle;
        if (!toggle) return;
        toggle.spriteId = this.setting.isEnabled() ? TOGGLE_ON_SPRITE : TOGGLE_OFF_SPRITE;
        this.client.widgetManager?.invalidateWidgetRender(toggle);
    }

    remove(): void {
        const row = this.row;
        const widgets = this.client.widgetManager;
        this.row = undefined;
        if (!row || !widgets) return;
        for (const widget of Object.values(row)) {
            const parent = widgets.getWidgetByUid(widget.parentUid ?? -1);
            const siblings = parent?.children as WidgetNode[] | null | undefined;
            const index = siblings?.indexOf(widget) ?? -1;
            if (!parent || !siblings || index < 0) continue;
            siblings.splice(index, 1);
            widgets.unregisterWidgetTree(widget);
            widgets.invalidateDynamicChildrenCache(parent);
            revalidate(widgets, parent);
        }
    }

    /** Controls is the category shown, or the search matches it. */
    private listed(): boolean {
        const vars = this.client.varManager;
        if (vars.getVarbit(FLOATER_IS_SEARCHING) !== 1) return vars.getVarbit(SETTINGS_CATEGORY) === CONTROLS_CATEGORY;
        const query = (vars.getVarcString(SETTINGS_SEARCH_STRING) ?? "").trim().toLowerCase();
        return query.length > 0 && SEARCH_TERMS.some((term) => term.includes(query));
    }

    /** A toggle row the cache built: its background, name, toggle and description. */
    private template(children: WidgetNode[]): Template | undefined {
        for (let i = 0; i + 3 < children.length; i++) {
            const [background, name, toggle, description] = children.slice(i, i + 4);
            const hover = (background as any).eventHandlers;
            if (background.type === WidgetType.RECTANGLE && hover?.onMouseOver && hover?.onMouseLeave &&
                name.type === WidgetType.TEXT && toggle.type === WidgetType.GRAPHIC &&
                (toggle.spriteId === TOGGLE_ON_SPRITE || toggle.spriteId === TOGGLE_OFF_SPRITE) &&
                description.type === WidgetType.TEXT) return { background, name, toggle, description };
        }
        return undefined;
    }

    private build(widgets: WidgetManager, rows: WidgetNode, clicks: WidgetNode, template: Template, top: number): Row {
        const copy = (parent: WidgetNode, source: WidgetNode, fields: string[], extra: object): WidgetNode => {
            const widget = createChild(widgets, parent, source.type ?? WidgetType.LAYER);
            for (const field of fields) (widget as any)[field] = (source as any)[field];
            return Object.assign(widget, extra);
        };
        const LAYOUT = ["rawX", "rawWidth", "rawHeight", "xPositionMode", "yPositionMode", "widthMode", "heightMode"];
        const TEXT = [...LAYOUT, "fontId", "textColor", "color", "textShadowed", "textShadow", "xTextAlignment", "yTextAlignment", "lineHeight"];
        const hover = (template.background as any).eventHandlers;
        const background = copy(rows, template.background, [...LAYOUT, "color", "filled", "transparency"], {
            rawHeight: ROW_HEIGHT, eventHandlers: { onMouseOver: { ...hover.onMouseOver }, onMouseLeave: { ...hover.onMouseLeave } },
        });
        const name = copy(rows, template.name, TEXT, { text: NAME });
        const toggle = copy(rows, template.toggle, LAYOUT, {});
        const description = copy(rows, template.description, TEXT, { text: DESCRIPTION, rawHeight: LINE_HEIGHT * DESCRIPTION_LINES });
        const click = copy(clicks, template.background, LAYOUT, {
            rawHeight: ROW_HEIGHT, color: 0xffffff, filled: true, transparency: 255, hasListener: true,
        });
        setAction(click, 0, "Toggle");
        (click as any).jsListeners = { onOp: () => this.toggle() };
        markWidgetInteractionDirty(click);
        const row = { background, name, toggle, description, click };
        this.place(widgets, row, top);
        return row;
    }

    private place(widgets: WidgetManager, row: Row, top: number): void {
        row.background.rawY = row.click.rawY = top;
        row.name.rawY = top + NAME_TOP;
        row.toggle.rawY = top + Math.floor((ROW_HEIGHT - (row.toggle.rawHeight ?? 0)) / 2);
        row.description.rawY = top + NAME_TOP + LINE_HEIGHT;
        for (const widget of Object.values(row)) revalidate(widgets, widget);
    }

    /** The list's scroll height reaches past the row, and the scrollbar follows. */
    private fitScroll(widgets: WidgetManager, height: number): void {
        const scroll = widgets.getWidgetByUid(SCROLL_LAYER);
        if (!scroll || (scroll.scrollHeight ?? 0) >= height) return;
        scroll.scrollHeight = height;
        for (const uid of [SCROLL_LAYER, ROWS_LAYER, CLICK_LAYER]) {
            const layer = widgets.getWidgetByUid(uid);
            if (layer) revalidate(widgets, layer);
        }
        const scrollbar = widgets.getWidgetByUid(SCROLLBAR);
        if (scrollbar) this.client.executeScriptListener(scrollbar, [SCROLLBAR_RESIZE_SCRIPT, SCROLLBAR, SCROLL_LAYER, scroll.scrollY ?? 0]);
    }

    private toggle(): void {
        if (!this.row) return;
        this.client.executeScriptListener(this.row.click, [CLICK_SOUND_SCRIPT]);
        this.setting.setEnabled(!this.setting.isEnabled());
        this.refresh();
    }
}
