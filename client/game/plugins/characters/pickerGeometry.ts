/**
 * Character picker, shown after a login with character select: a title, one flat row per
 * character (plus a New character row while there is room), Play and Delete under them and a
 * Sign out link at the bottom. Typing a new name or a delete confirmation swaps the rows for a
 * prompt and a name field, and the buttons for Create or Delete and Cancel.
 */
export const PICKER_TITLE_Y = 192;
export const PICKER_ROWS_Y = 198;
/**
 * Row height up to four rows (three characters and the New row), tall enough for the stats and
 * the last-played line; more rows share PICKER_ROWS_AREA_H and keep only the stats. Four rows end
 * at 298, above the titlebuttons centred on PICKER_BUTTON_Y.
 */
export const PICKER_ROW_H = 25;
export const PICKER_ROW_W = 320;
export const PICKER_ROWS_AREA_H = 100;
/** Centre of the Play / Create / Delete (left) and Delete / Cancel (right) titlebuttons. */
export const PICKER_BUTTON_Y = 322;
export const PICKER_LEFT_BUTTON_DX = 100;
export const PICKER_RIGHT_BUTTON_DX = 260;
export const PICKER_SIGN_OUT_Y = 356;
export const PICKER_SIGN_OUT_TEXT = "Sign out";
export const PICKER_SIGN_OUT_HALF_W = 40;
export const PICKER_SIGN_OUT_HALF_H = 8;
/** Baselines of the prompt, the name field and the server's message while typing. */
export const PICKER_PROMPT_Y = PICKER_ROWS_Y + 20;
export const PICKER_FIELD_Y = PICKER_ROWS_Y + 45;
export const PICKER_MESSAGE_Y = PICKER_ROWS_Y + 70;
export const PICKER_MAX_NAME_LENGTH = 12;
export const PICKER_NO_SAVE_TEXT = "Enter the world once with your first character";

export function getPickerRowX(host: { loginBoxX: number }): number {
    return host.loginBoxX + 20;
}

export function getPickerRowCount(state: { characters: unknown[]; maxCharacters: number }): number {
    return state.characters.length + (state.characters.length < state.maxCharacters ? 1 : 0);
}

export function getPickerRowHeight(rows: number): number {
    return rows <= 4 ? PICKER_ROW_H : Math.floor(PICKER_ROWS_AREA_H / rows);
}
