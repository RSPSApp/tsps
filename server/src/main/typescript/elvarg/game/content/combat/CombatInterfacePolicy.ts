/**
 * The interface groups that stay open while their owner is being hit.
 *
 * Taking a hit closes the player's interfaces (`CombatFactory.applyDamage`), which is right for
 * banks, shops and dialogues: a fight should interrupt them, and that is how the real game
 * behaves. It is wrong for a game mode whose own screen is the thing the player watches *while*
 * the character fights — closing it on every hit makes it impossible to keep open.
 *
 * A mode registers its screens here, through `api.core`, and only those groups survive. Everything
 * else is closed exactly as before.
 */
export class CombatInterfacePolicy {
    private static readonly keep = new Set<number>();

    /** Lets the interface group `groupId` stay open while its owner takes hits. */
    static keepOpenInCombat(groupId: number): void {
        if (Number.isInteger(groupId) && groupId > 0) {
            CombatInterfacePolicy.keep.add(groupId);
        }
    }

    /** Whether `groupId` was registered to survive being hit. */
    static survivesCombat(groupId: number): boolean {
        return CombatInterfacePolicy.keep.has(groupId);
    }

    /** Drops every registration: plugins re-register as they are attached on a reload. */
    static reset(): void {
        CombatInterfacePolicy.keep.clear();
    }
}
