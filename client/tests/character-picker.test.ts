import assert from "node:assert/strict";

import { CHARACTER_LIST_WAIT_MS, CharacterListWait } from "../game/plugins/characters/characterListWait";
import { decideCharacterList, decideCharacterResult, leaveRefusedReconnect } from "../game/plugins/characters/characterFlow";
import { GameState, LoginIndex } from "../game/login/GameState";
import { PickerActions as LoginActions } from "../game/plugins/characters/PickerAction";
import { CharacterPickerState } from "../game/plugins/characters/CharacterPickerState";
import { LoginState } from "../game/login/LoginState";
import { handlePickerKey, getCharacterSelectEnterAction } from "../game/plugins/characters/pickerInput";
import { handleCharacterSelectClick } from "../game/plugins/characters/pickerInput";
import {
    getPickerRowHeight,
    PICKER_BUTTON_Y,
    PICKER_ROW_H,
    PICKER_ROWS_Y,
    PICKER_SIGN_OUT_Y,
    PICKER_TITLE_Y,
} from "../game/plugins/characters/pickerGeometry";

// Rows are tall enough for the stats and last-played lines, and three characters plus the New
// row end above the titlebuttons (about 40 tall, centred on PICKER_BUTTON_Y) and below the title.
assert.equal(PICKER_ROW_H, 25);
assert.equal(getPickerRowHeight(4), PICKER_ROW_H);
assert.ok(PICKER_ROWS_Y > PICKER_TITLE_Y + 3);
assert.ok(PICKER_ROWS_Y + 4 * PICKER_ROW_H <= PICKER_BUTTON_Y - 20);
assert.ok(getPickerRowHeight(5) < PICKER_ROW_H, "more rows share the area and drop the second line");
import { LOGIN_FLAG_CHARACTER_SELECT, LOGIN_FLAG_TOKEN } from "../network/serverConnection/constants";

const store = new Map<string, string>();
const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
};
(globalThis as any).window = { localStorage, location: { hostname: "localhost" } };
(globalThis as any).localStorage = localStorage;

const zezima = { name: "Zezima", combatLevel: 126, totalLevel: 2277, lastPlayedAt: 1, primary: true, hasSave: true };
const alt = { name: "Zezalt", combatLevel: 3, totalLevel: 32, lastPlayedAt: 2, primary: false, hasSave: true };
const host = { loginBoxX: 202, contentScale: 1, layoutConfig: { isTouch: false, minTouchTarget: 0 } } as any;

// State transitions: the list shows the picker with the server's default selected.
const state = new CharacterPickerState(new LoginState());
state.showCharacterSelect({ maxCharacters: 3, defaultIndex: 1, characters: [zezima, alt] });
assert.equal(state.selectedCharacter, 1);
assert.equal(state.pickerMode, "list");

// Hit tests: rows, the empty slot, Play, Delete (not on the primary), Sign out, Cancel.
assert.deepEqual(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 5), {
    type: "select_character",
    index: 0,
});
assert.deepEqual(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + PICKER_ROW_H + 5), {
    type: "select_character",
    index: 1,
});
assert.equal(
    handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 2 * PICKER_ROW_H + 5),
    LoginActions.NEW_CHARACTER,
    "the empty slot row",
);
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_BUTTON_Y), LoginActions.PLAY_CHARACTER);
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 260, PICKER_BUTTON_Y), LoginActions.DELETE_CHARACTER);
state.selectedCharacter = 0;
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 260, PICKER_BUTTON_Y), undefined, "no delete on the primary");
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 180, PICKER_SIGN_OUT_Y), LoginActions.SIGN_OUT_PICKER);
assert.equal(getCharacterSelectEnterAction(state), LoginActions.PLAY_CHARACTER, "Enter in the list plays");

state.pickerMode = "create";
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 260, PICKER_BUTTON_Y), LoginActions.CANCEL_PICKER_INPUT);
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_BUTTON_Y), LoginActions.SUBMIT_PICKER_INPUT);
assert.equal(
    handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 5),
    undefined,
    "the rows area holds the name field while typing",
);
assert.equal(getCharacterSelectEnterAction(state), LoginActions.SUBMIT_PICKER_INPUT, "Enter in a field submits");

// Keyboard: typing edits the field, at most 12 characters.
handlePickerKey(state, "", "a");
handlePickerKey(state, "", "b");
assert.equal(state.pickerInput, "ab");
handlePickerKey(state, "Backspace", "");
assert.equal(state.pickerInput, "a");
for (const ch of "bcdefghijklmnop") handlePickerKey(state, "", ch);
assert.equal(state.pickerInput, "abcdefghijkl");
state.pickerMode = "list";
state.pickerInput = "";
assert.equal(handlePickerKey(state, "", "x"), false, "the list has no field to type into");
assert.equal(state.pickerInput, "");

// A full account shows no New row.
state.showCharacterSelect({ maxCharacters: 2, defaultIndex: 0, characters: [zezima, alt] });
assert.equal(
    handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 2 * PICKER_ROW_H + 5),
    undefined,
);

// The New row is inert until the primary has entered the world once (the server answers 9).
state.showCharacterSelect({ maxCharacters: 3, defaultIndex: 0, characters: [{ ...zezima, hasSave: false }] });
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + PICKER_ROW_H + 5), undefined);

// The picker's state is part of the redraw hash.
const before = state.pickerHash();
state.hoveredCharacter = 0;
assert.notEqual(state.pickerHash(), before);

// A server without character slots never sends the list: the handshake goes after the wait.
type Pending = { cb: () => void; ms: number };
let pending: Pending | undefined;
const timers = {
    set: (cb: () => void, ms: number) => {
        pending = { cb, ms };
        return pending;
    },
    clear: (handle: unknown) => {
        if (pending === handle) pending = undefined;
    },
};
let handshakes = 0;
const wait = new CharacterListWait(timers);
wait.onLoginAccepted(LOGIN_FLAG_TOKEN | LOGIN_FLAG_CHARACTER_SELECT, () => handshakes++);
assert.equal(handshakes, 0, "held while the list may still come");
assert.equal(pending?.ms, CHARACTER_LIST_WAIT_MS);
assert.equal(CHARACTER_LIST_WAIT_MS, 1500);
pending!.cb();
assert.equal(handshakes, 1, "an old server gets the handshake after the wait");

// The list arriving in time cancels it.
wait.onLoginAccepted(LOGIN_FLAG_CHARACTER_SELECT, () => handshakes++);
assert.equal(wait.onCharacterList(), true);
assert.equal(pending, undefined);
assert.equal(handshakes, 1);

// Without the flag nothing is held.
wait.onLoginAccepted(LOGIN_FLAG_TOKEN, () => handshakes++);
assert.equal(handshakes, 2);
assert.equal(pending, undefined);

// CHARACTER_LIST: the list a login waited for shows the picker; strays are ignored.
const list = (gameState: GameState, pickerOpen: boolean, expected: boolean, sessionCharacter: string | null = null) =>
    decideCharacterList({ gameState, pickerOpen, expected, sessionCharacter, maxCharacters: 3, characters: [zezima] });
assert.equal(decideCharacterList({
    gameState: GameState.CONNECTING,
    pickerOpen: false,
    expected: true,
    sessionCharacter: null,
    maxCharacters: 3,
    characters: [{ ...zezima, hasSave: false }],
}), "select_default", "a first login enters the primary without an extra click");
assert.equal(decideCharacterList({
    gameState: GameState.CONNECTING,
    pickerOpen: false,
    expected: false,
    sessionCharacter: null,
    maxCharacters: 3,
    characters: [{ ...zezima, hasSave: false }],
}), "ignore", "a late list must not auto-select");
for (const characters of [[zezima], [zezima, alt]]) {
    assert.equal(decideCharacterList({
        gameState: GameState.CONNECTING,
        pickerOpen: false,
        expected: true,
        sessionCharacter: null,
        maxCharacters: 1,
        characters,
    }), "select_default", "disabled slots bypass the picker, including accounts with old alts");
}
assert.equal(list(GameState.CONNECTING, false, true), "show_picker");
assert.equal(list(GameState.CONNECTING, true, false), "show_picker", "the refresh after a create");
assert.equal(list(GameState.CONNECTING, false, false), "ignore", "late, after the fallback handshake");
assert.equal(list(GameState.LOADING_GAME, false, false), "ignore", "late, after the fallback handshake");
assert.equal(list(GameState.LOGGED_IN, true, false, "Zezima"), "ignore", "in game");
assert.equal(list(GameState.LOGGED_IN, true, true, "Zezima"), "ignore", "in game");
assert.equal(list(GameState.LOGIN_SCREEN, false, true), "ignore");
assert.equal(list(GameState.CONNECTION_LOST, true, true, "Zezalt"), "reselect");
assert.equal(list(GameState.CONNECTION_LOST, true, false, "Zezalt"), "ignore");
assert.equal(
    list(GameState.CONNECTION_LOST, true, true, null),
    "reopen_picker",
    "dropped while choosing: the picker again, no select sent",
);

assert.equal(decideCharacterList({
    gameState: GameState.CONNECTION_LOST,
    pickerOpen: true,
    expected: true,
    sessionCharacter: null,
    maxCharacters: 1,
    characters: [zezima],
}), "reselect", "disabled slots also skip reopening a dropped picker");

// CHARACTER_RESULT: matched to the request it answers.
const result = (pending: "select" | "create" | "delete" | undefined, ok: boolean, gameState = GameState.CONNECTING) =>
    decideCharacterResult({ pending, ok, gameState });
assert.equal(result(undefined, true), "ignore", "no request pending");
assert.equal(result(undefined, false, GameState.CONNECTION_LOST), "ignore");
assert.equal(result("select", true), "handshake");
assert.equal(result("select", true, GameState.CONNECTION_LOST), "handshake");
assert.equal(result("create", true), "back_to_list");
assert.equal(result("delete", false), "show_message");
assert.equal(result("select", false), "show_message");
assert.equal(result("select", false, GameState.CONNECTION_LOST), "abandon_reconnect");

// A refused reconnect select drops the connection for good and shows why on Try again.
const calls: string[] = [];
const refused = new LoginState();
refused.loginIndex = LoginIndex.LOGIN_FORM;
leaveRefusedReconnect(refused, "That character is already logged in.", {
    suppressReconnection: () => calls.push("suppress"),
    disposeServerConnection: () => calls.push("dispose"),
});
assert.deepEqual(calls, ["suppress", "dispose"]);
assert.equal(refused.loginIndex, LoginIndex.TRY_AGAIN);
assert.equal(refused.response1, "That character is already logged in.");

console.log("Character picker test passed");
