/**
 * Client settings that scripts set and the client itself reads: which players have their name
 * drawn over them, the free camera's speeds, and the platform the client runs on.
 */

/** Bits of `drawPlayerNames`, one per setdrawplayernames_* instruction. */
export const DRAW_NAMES_FRIENDS = 1;
export const DRAW_NAMES_CLANMATES = 2;
export const DRAW_NAMES_OTHERS = 4;
export const DRAW_NAMES_SELF = 8;

/** platformtype for a desktop client that did not log in through a launcher. */
export const PLATFORM_DESKTOP = 0;

export const clientDisplayState = {
    /** Whose names are drawn over their heads (DRAW_NAMES_* bits); 0 draws none. */
    drawPlayerNames: 0,
    /** Free camera movement speed, and its speed while the slow key is held. */
    freeCamSpeed: 12,
    freeCamSlowSpeed: 6,
    platformType: PLATFORM_DESKTOP,
};

export function resetClientDisplayState(): void {
    clientDisplayState.drawPlayerNames = 0;
    clientDisplayState.freeCamSpeed = 12;
    clientDisplayState.freeCamSlowSpeed = 6;
    clientDisplayState.platformType = PLATFORM_DESKTOP;
}
