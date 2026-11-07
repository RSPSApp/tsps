import type { LoginState } from "../../login/LoginState";
import type { CharacterListPayload, CharacterSummary } from "../../../network/packet/ServerBinaryDecoder";

export class CharacterPickerState {
    constructor(private readonly login: LoginState) {}
    get virtualKeyboardVisible(): boolean { return this.login.virtualKeyboardVisible; }
    set virtualKeyboardVisible(value: boolean) { this.login.virtualKeyboardVisible = value; }
    // ========== Character select ==========

    /** The account's characters on this server, from the last character list. */
    characters: CharacterSummary[] = [];

    /** How many characters the account may have here; below it the picker offers a New row. */
    maxCharacters: number = 1;

    /** Index into characters of the highlighted row (Play enters it). */
    selectedCharacter: number = 0;

    /** Picker row under the mouse (-1 = none); characters.length is the New row. */
    hoveredCharacter: number = -1;

    /** The rows, or the name field for a new character or a delete confirmation. */
    pickerMode: "list" | "create" | "delete" = "list";

    /** Text typed into the picker's name field. */
    pickerInput: string = "";

    /** The server's answer to the last refused request, drawn in red. */
    pickerMessage: string = "";

    /** A select, create or delete is waiting for the server's result. */
    pickerBusy: boolean = false;

    /** Shows the character picker for a character list from the server. */
    showCharacterSelect(payload: CharacterListPayload): void {
        this.characters = payload.characters;
        this.maxCharacters = payload.maxCharacters;
        this.selectedCharacter = Math.max(0, Math.min(payload.defaultIndex, payload.characters.length - 1));
        this.hoveredCharacter = -1;
        this.pickerMode = "list";
        this.pickerInput = "";
        this.pickerMessage = "";
        this.pickerBusy = false;
        this.virtualKeyboardVisible = false;
    }

    /** Whether the picker offers a New character row. */
    hasNewCharacterRow(): boolean {
        return this.characters.length < this.maxCharacters;
    }

    /** The server refuses a new character until the first one has entered the world once. */
    canCreateCharacter(): boolean {
        return this.hasNewCharacterRow() && this.characters[0]?.hasSave !== false;
    }

    /** Everything the picker draws, for the title's redraw hash. */
    pickerHash(): string {
        return `${this.characters.map((c) => c.name + c.lastPlayedAt).join(",")}|${this.selectedCharacter}|${
            this.hoveredCharacter
        }|${this.pickerMode}|${this.pickerInput.length}|${this.pickerMessage}|${this.pickerBusy}|${this.maxCharacters}`;
    }

}
