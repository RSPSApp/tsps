/**
 * OSRS set_item_ops_disabled (hideobjops): one boolean for the whole client's ground items
 * ("obj", not loc scenery). The native client keeps it in a static
 * (`WorldMapRectangle.itemOpsDisabled`) and, in Message.addGroundItemToMenu, drops Use, Cast,
 * every ground action and the Take fallback. Examine is only added in the no-selection branch,
 * so a selected spell hides it too; unlike NPCs there is no low-priority follower case.
 */
export class GroundObjOpsVisibility {
    hidden = false;

    set(hidden: boolean): void {
        this.hidden = hidden === true;
    }

    clear(): void {
        this.hidden = false;
    }
}

/** Whether the ground-item Examine entry is still added while its actions are hidden. */
export function groundObjExamineVisibleWhileHidden(spellSelected: boolean): boolean {
    return !spellSelected;
}

export const groundObjOpsVisibility = new GroundObjOpsVisibility();
