import type { MenuTargetType } from "../../rs/MenuEntry";
import type { SimpleMenuEntry } from "./MenuEngine";

/**
 * Where a menu comes from. World menus mix several targets, each entry carrying its own
 * targetType/targetId; an inventory item's menu is one target, given here. `menu` is true when
 * the list is the right-click menu itself (entries may be added), false when it only decides
 * the left-click and hover text (order only).
 */
export type MenuTransformContext =
    | { surface: "world"; menu: true }
    | {
          surface: "inventory";
          menu: boolean;
          target: { type: MenuTargetType; id: number; name: string };
      };

/** Reorders or extends a menu (display order, top first) and returns the new list. */
export type MenuTransform = (
    entries: SimpleMenuEntry[],
    context: MenuTransformContext,
) => SimpleMenuEntry[];

let transform: MenuTransform | undefined;

/** Installed once by the client: the client plugins' transformMenuEntries chain. */
export function setMenuTransform(next: MenuTransform | undefined): void {
    transform = next;
}

/**
 * The menu as the client plugins want it. Applied on every use (not cached), so a change of
 * settings or of held keys shows at once; the input array and its entries are never modified.
 */
export function applyMenuTransform(
    entries: SimpleMenuEntry[],
    context: MenuTransformContext,
): SimpleMenuEntry[] {
    if (!transform || entries.length === 0) return entries;
    try {
        return transform(entries, context);
    } catch (err) {
        console.warn?.("[menu] transform failed", err);
        return entries;
    }
}
