import assert from "node:assert/strict";

import { CHARACTER_LIST_WAIT_MS, CharacterListWait } from "../game/login/characterListWait";
import { LoginIndex } from "../game/login/GameState";
import { LoginActions } from "../game/login/LoginAction";
import { LoginState } from "../game/login/LoginState";
import { handleKeyInput, getCharacterSelectEnterAction } from "../game/login/renderer/input/keyboard";
import { handleCharacterSelectClick } from "../game/login/renderer/input/mouseHandlers";
import {
    PICKER_BUTTON_Y,
    PICKER_ROW_H,
    PICKER_ROWS_Y,
    PICKER_SIGN_OUT_Y,
} from "../game/login/renderer/layout/geometry";
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
const state = new LoginState();
state.showCharacterSelect({ maxCharacters: 3, defaultIndex: 1, characters: [zezima, alt] });
assert.equal(state.loginIndex, LoginIndex.CHARACTER_SELECT);
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
handleKeyInput(host, state, "", "a");
handleKeyInput(host, state, "", "b");
assert.equal(state.pickerInput, "ab");
handleKeyInput(host, state, "Backspace", "");
assert.equal(state.pickerInput, "a");
for (const ch of "bcdefghijklmnop") handleKeyInput(host, state, "", ch);
assert.equal(state.pickerInput, "abcdefghijkl");
state.pickerMode = "list";
state.pickerInput = "";
assert.equal(handleKeyInput(host, state, "", "x"), false, "the list has no field to type into");
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

console.log("Character picker test passed");
