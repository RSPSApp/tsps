/**
 * OSRS set_hide_npc_actions (hidenpcops): one boolean for the whole client, not a per-NPC
 * flag. The native client keeps it in a static (`LazySoundRequest.hideNpcActions`) and, in
 * WidgetRenderer, still adds NPC Examine while dropping Use, Cast, every action and Attack.
 * While a spell is selected it adds no Examine either; a low-priority follower already has
 * Examine at the top of the menu.
 */
export class NpcOpsVisibility {
    hidden = false;

    set(hidden: boolean): void {
        this.hidden = hidden === true;
    }

    clear(): void {
        this.hidden = false;
    }
}

/** Whether the bottom NPC Examine entry is still added while its actions are hidden. */
export function npcExamineVisibleWhileHidden(spellSelected: boolean, followerLowPriority: boolean): boolean {
    return !spellSelected && !followerLowPriority;
}

export const npcOpsVisibility = new NpcOpsVisibility();
