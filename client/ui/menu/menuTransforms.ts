import type { MenuTargetType } from "../../rs/MenuEntry";
import type { SimpleMenuEntry } from "./MenuEngine";
import { BANKMAIN, CA_TASKS, STATS } from "../../runelite/api/gameval/InterfaceID";
import { buildPluginMenu, preparePluginMenu } from "./menuEvents";

/**
 * Where a menu comes from. World menus mix several targets, each entry carrying its own
 * targetType/targetId; an inventory item's menu is one target, given here. `menu` is true when
 * the list is the right-click menu itself (entries may be added), false when it only decides
 * the left-click and hover text (order only).
 */
export type MenuTransformContext =
    | { surface: "world"; menu: true }
    | { surface: "widget"; menu: boolean; widgetId: number; childIndex: number; itemId: number }
    | {
          surface: "inventory";
          menu: boolean;
          target: { type: MenuTargetType; id: number; name: string };
          widgetId?: number; childIndex?: number; itemId?: number;
      };

/** Reorders or extends a menu (display order, top first) and returns the new list. */
export type MenuTransform = (
    entries: SimpleMenuEntry[],
    context: MenuTransformContext,
) => SimpleMenuEntry[];

let transform: MenuTransform | undefined;
let managedMenus: MenuTransform | undefined;

/** Installed once by the client: the client plugins' transformMenuEntries chain. */
export function setMenuTransform(next: MenuTransform | undefined): void {
    transform = next;
}

/** Installed once by the client: RuneLite's MenuManager, which adds options to given widgets. */
export function setManagedMenus(next: MenuTransform | undefined): void {
    managedMenus = next;
}

/**
 * Plugins see world and inventory menus, the opened right-click menu of an item in any other
 * interface (worn equipment, the bank's inventory side, a shop's inventory side...), as
 * RuneLite's MenuOpened does, and the opened menu of a skill on the stats tab, a combat
 * achievement task or anything in the bank (RuneLite's MenuEntryAdded, which Bank Tags uses for
 * the deposit buttons and its tag tabs, and Wiki for its skill and task options). Other widget
 * menus, and their left-click/hover order, stay with the widget layer.
 */
function reachesPlugins(context: MenuTransformContext): boolean {
    if (context.surface !== "widget") return true;
    const group = context.widgetId >>> 16;
    return context.menu && (context.itemId > 0 || group === STATS || group === CA_TASKS || group === BANKMAIN);
}

/**
 * The menu as the client plugins want it. Applied on every use (not cached), so a change of
 * settings or of held keys shows at once; the input array and its entries are never modified.
 */
export function applyMenuTransform(
    entries: SimpleMenuEntry[],
    context: MenuTransformContext,
    prepared: boolean = false,
): SimpleMenuEntry[] {
    if (!prepared) entries = preparePluginMenu(entries, context);
    // MenuManager adds its options as the entries are added, before plugins see the menu.
    if (managedMenus && context.surface !== "world") {
        try {
            entries = managedMenus(entries, context);
        } catch (err) {
            console.warn?.("[menu] managed menus failed", err);
        }
    }
    if (!transform || !reachesPlugins(context)) return buildPluginMenu(entries, context);
    try {
        return buildPluginMenu(transform(entries, context), context);
    } catch (err) {
        console.warn?.("[menu] transform failed", err);
        return entries;
    }
}
