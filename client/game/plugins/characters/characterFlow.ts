import { GameState, LoginIndex } from "../../login/GameState";
import type { LoginState } from "../../login/LoginState";

export type CharacterRequestKind = "select" | "create" | "delete";

/** States a dropped session sits in while it logs in again. */
function isReconnecting(gameState: GameState): boolean {
    return (
        gameState === GameState.CONNECTION_LOST ||
        gameState === GameState.RECONNECTING ||
        gameState === GameState.PLEASE_WAIT
    );
}

/**
 * What a CHARACTER_LIST means. `expected` is whether an accepted login was still waiting for it
 * (CharacterListWait); a list after the fallback handshake, or in game, is stray.
 */
export function decideCharacterList(args: {
    gameState: GameState;
    pickerOpen: boolean;
    expected: boolean;
    sessionCharacter: string | null;
    maxCharacters: number;
    characters: readonly { primary: boolean; hasSave: boolean }[];
}): "show_picker" | "reopen_picker" | "reselect" | "select_default" | "ignore" {
    const { gameState, pickerOpen, expected, sessionCharacter } = args;
    if (gameState === GameState.CONNECTING) {
        if (expected && (args.maxCharacters === 1 || (args.characters.length === 1 && args.characters[0].primary && !args.characters[0].hasSave))) {
            return "select_default";
        }
        // The picker's own refresh after a create or delete, or the list a login waited for.
        return expected || pickerOpen ? "show_picker" : "ignore";
    }
    if (!expected || !isReconnecting(gameState)) return "ignore";
    // Dropped while still choosing: ask again rather than entering the default character.
    if (sessionCharacter === null && pickerOpen && args.maxCharacters > 1) return "reopen_picker";
    return "reselect";
}

/** What a CHARACTER_RESULT means for the request it answers. */
export function decideCharacterResult(args: {
    pending: CharacterRequestKind | undefined;
    ok: boolean;
    gameState: GameState;
}): "ignore" | "handshake" | "back_to_list" | "show_message" | "abandon_reconnect" {
    const { pending, ok, gameState } = args;
    if (pending === undefined) return "ignore";
    if (ok) return pending === "select" ? "handshake" : "back_to_list";
    // A reconnect's select has no picker to show the refusal on, and its open socket never
    // closes, so the reconnect would wait forever.
    return gameState === GameState.CONNECTING ? "show_message" : "abandon_reconnect";
}

/**
 * Drops a reconnect the server refused to re-enter, and puts the refusal on the Try again
 * screen. The caller then moves to the login screen.
 */
export function leaveRefusedReconnect(
    state: LoginState,
    message: string,
    connection: { suppressReconnection(): void; disposeServerConnection(reason: string): void },
): void {
    connection.suppressReconnection();
    connection.disposeServerConnection("character select refused");
    state.loginWithToken = false;
    state.loginIndex = LoginIndex.TRY_AGAIN;
    state.setResponse("", message || "Unable to enter that character.", "", "");
}
