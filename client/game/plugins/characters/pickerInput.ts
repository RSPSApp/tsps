import { PICKER_MAX_NAME_LENGTH } from "./pickerGeometry";

import type { CharacterPickerState } from "./CharacterPickerState";
import { PickerActions as LoginActions, type PickerAction as LoginAction } from "./PickerAction";
import type { LoginRendererHost } from "../../login/renderer/host";
import { isButtonHit } from "../../login/renderer/input/mouseHandlers";
import {
    getPickerRowCount,
    getPickerRowHeight,
    getPickerRowX,
    PICKER_BUTTON_Y,
    PICKER_LEFT_BUTTON_DX,
    PICKER_RIGHT_BUTTON_DX,
    PICKER_ROW_W,
    PICKER_ROWS_Y,
    PICKER_SIGN_OUT_HALF_H,
    PICKER_SIGN_OUT_HALF_W,
    PICKER_SIGN_OUT_Y,
} from "./pickerGeometry";

/** Characters a character name may hold; the server checks the rest. */
const PICKER_NAME_CHAR = /^[A-Za-z0-9 _-]$/;

/** Enter on the character picker: Play in the list, else submit the name field. */
export function getCharacterSelectEnterAction(state: CharacterPickerState) {
    return state.pickerMode === "list" ? LoginActions.PLAY_CHARACTER : LoginActions.SUBMIT_PICKER_INPUT;
}

/** The picker row at a content-space point: a character index, characters.length for New, or -1. */
export function getCharacterRowAt(host: LoginRendererHost, state: CharacterPickerState, x: number, y: number): number {
    if (state.pickerMode !== "list") return -1;
    const rows = getPickerRowCount(state);
    const rowH = getPickerRowHeight(rows);
    const rowX = getPickerRowX(host);
    if (x < rowX || x >= rowX + PICKER_ROW_W || y < PICKER_ROWS_Y || y >= PICKER_ROWS_Y + rows * rowH) return -1;
    return Math.floor((y - PICKER_ROWS_Y) / rowH);
}

export function handleCharacterSelectClick(host: LoginRendererHost, state: CharacterPickerState, x: number, y: number): LoginAction | undefined {
    if (state.pickerMode === "list") {
        const row = getCharacterRowAt(host, state, x, y);
        if (row >= 0 && row < state.characters.length) {
            return { type: "select_character", index: row };
        }
        if (row === state.characters.length) {
            return state.canCreateCharacter() ? LoginActions.NEW_CHARACTER : undefined;
        }
    }
    // Checked before the buttons above it; on touch it only grows downwards, away from them.
    const scale = host.contentScale > 0 ? host.contentScale : 1;
    const touchHalf = host.layoutConfig.isTouch ? Math.ceil(host.layoutConfig.minTouchTarget / 2 / scale) : 0;
    if (
        Math.abs(x - (host.loginBoxX + 180)) <= Math.max(PICKER_SIGN_OUT_HALF_W, touchHalf) &&
        y >= PICKER_SIGN_OUT_Y - PICKER_SIGN_OUT_HALF_H &&
        y <= PICKER_SIGN_OUT_Y + Math.max(PICKER_SIGN_OUT_HALF_H, touchHalf)
    ) {
        return LoginActions.SIGN_OUT_PICKER;
    }
    if (isButtonHit(host, x, y, host.loginBoxX + PICKER_LEFT_BUTTON_DX, PICKER_BUTTON_Y)) {
        return state.pickerMode === "list" ? LoginActions.PLAY_CHARACTER : LoginActions.SUBMIT_PICKER_INPUT;
    }
    if (isButtonHit(host, x, y, host.loginBoxX + PICKER_RIGHT_BUTTON_DX, PICKER_BUTTON_Y)) {
        if (state.pickerMode !== "list") return LoginActions.CANCEL_PICKER_INPUT;
        const selected = state.characters[state.selectedCharacter];
        return selected && !selected.primary ? LoginActions.DELETE_CHARACTER : undefined;
    }
    return undefined;
}

export function handlePickerKey(state: CharacterPickerState, key: string, char: string): boolean {
    // Enter goes through getCharacterSelectEnterAction; the list has no field.
    if (state.pickerMode === "list") return false;
    if (key === "Backspace") {
        state.pickerInput = state.pickerInput.slice(0, -1);
        return true;
    }
    if (PICKER_NAME_CHAR.test(char)) {
        if (state.pickerInput.length < PICKER_MAX_NAME_LENGTH) {
            state.pickerInput += char;
        }
        return true;
    }

    return false;
}
