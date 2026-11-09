import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import { MenuState } from "../../../ui/menu/MenuState";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import { deriveMenuEntriesForWidget, hasContextMenuOption } from "../../../widgets/menu/utils";
import { asWorldMenuEntries, isChatMessageAreaWidget } from "./chatboxClickThrough";
import { collectInputWidgetsAtPoint } from "./widgetClickProbe";

/**
 * The options of the click-through chat line at (x, y), for the world menu that a right-click
 * there opens: the widget layer never sees that click once the world menu has it.
 */
export function chatLineMenuEntriesAt(
    widgetManager: WidgetManager | undefined,
    ui: any,
    x: number,
    y: number,
    includeExamineIds: boolean,
): SimpleMenuEntry[] {
    if (!widgetManager || widgetManager.rootInterface === -1) return [];
    const hits = collectInputWidgetsAtPoint(widgetManager, x, y);
    for (let i = hits.length - 1; i >= 0; i--) {
        const widget = hits[i];
        if (!isChatMessageAreaWidget(widget)) continue;
        const custom: any[] = ui?.getWidgetMenuEntries?.(widget, x | 0, y | 0) ?? [];
        const entries = custom.concat(
            deriveMenuEntriesForWidget(
                widget,
                custom.length > 0,
                (w) => widgetManager.getWidgetFlags(w),
                (uid) => widgetManager.getWidgetByUid(uid),
                (w) => widgetManager.getWidgetOpMask(w),
            ) ?? [],
        );
        if (!hasContextMenuOption(entries)) continue;
        // Loaded here as the widget layer loads it (it pulls in the menu dispatch).
        const { widgetEntriesToSimple } = require("../../../ui/menu/MenuBridge");
        const menuState = new MenuState();
        const mapped: SimpleMenuEntry[] = widgetEntriesToSimple(entries, {
            ui,
            chosenWidget: widget,
            scheduleRender: () => {},
            menuState,
            label: { includeExamineIds },
        });
        return asWorldMenuEntries(mapped, (index, ix, iy, ctx) =>
            menuState.invoke(index, ix, iy, ctx),
        );
    }
    return [];
}
