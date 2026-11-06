import type { OsrsClient } from "../OsrsClient";

/**
 * Takes a piece of the canvas interface off the screen so a React panel can stand in its place.
 *
 * The replacement panels are not decoration over the old chrome: the old chrome goes, and the new
 * one takes the space. That only works if the canvas widget actually stops drawing, which is what
 * this does — the same two flags and the same invalidation the client itself uses when the server
 * sends hidden components (OsrsClient's `hiddenUids` handling) and the same pair the tab-reorder
 * plugin sets.
 *
 * It is re-applied every tick on purpose. CS2 scripts redraw their own groups and will happily
 * un-hide a component between two ticks; a one-shot hide flickers.
 */

/** What each widget looked like before we touched it, so giving the group back is exact. */
type Saved = { hidden: boolean | undefined; isHidden: boolean };

const saved = new WeakMap<object, Map<number, Saved>>();

function store(client: OsrsClient): Map<number, Saved> {
    let map = saved.get(client as object);
    if (!map) {
        map = new Map();
        saved.set(client as object, map);
    }
    return map;
}

/**
 * True when some other interface is mounted inside this group — a dialogue in the chat area, for
 * instance. Hiding the group then would take the dialogue with it, so we leave the group alone and
 * let the canvas have the space back for as long as it is being used for something we do not
 * replace.
 */
export function hasMountedChild(client: OsrsClient, groupId: number): boolean {
    const parents = client.widgetManager?.interfaceParents;
    if (!parents) return false;
    for (const uid of parents.keys()) {
        if (uid >>> 16 === groupId) return true;
    }
    return false;
}

/** Hides (or gives back) every root of `groupId`. Safe to call every tick. */
export function suppressCanvasGroup(client: OsrsClient, groupId: number, suppress: boolean): void {
    const manager = client?.widgetManager;
    if (!manager) return;
    const roots = manager.getAllGroupRoots?.(groupId) ?? [];
    if (roots.length === 0) return;
    const memory = store(client);

    for (const root of roots) {
        if (!root) continue;
        if (suppress) {
            if (!memory.has(root.uid)) {
                memory.set(root.uid, { hidden: root.hidden, isHidden: root.isHidden });
            }
            if (root.hidden === true && root.isHidden === true) continue;
            root.hidden = true;
            root.isHidden = true;
            manager.invalidateWidgetRender(root);
        } else {
            const before = memory.get(root.uid);
            if (!before) continue;
            memory.delete(root.uid);
            root.hidden = before.hidden;
            root.isHidden = before.isHidden;
            manager.invalidateWidgetRender(root);
        }
    }
}
