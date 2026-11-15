/**
 * The owner's noclip flag (::noclip, plugins/commands/AdminCommands.plugin.js). It is a per-player attribute, not persisted:
 * a flagged player's own steps and routes ignore collision; every other mobile is unchanged. The key is the one the command
 * sets.
 */
export const NOCLIP_ATTRIBUTE = "admin:noclip";

/** Whether this mobile is a player whose owner noclip is on. NPCs and unflagged players are never noclip. */
export function isNoclip(mobile: any): boolean {
    return mobile?.isPlayer?.() === true && mobile.getAsPlayer().getAttribute(NOCLIP_ATTRIBUTE) === true;
}
