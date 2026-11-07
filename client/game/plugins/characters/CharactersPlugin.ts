import { Plugin, type PluginDescriptor } from "../../../runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "../../../runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../../OsrsClient";
import { GameState } from "../../login/GameState";
import type { LoginScreenExtension } from "../../login/LoginScreenExtension";
import type { LoginRendererHost, RenderContext } from "../../login/renderer/host";
import type { GameStateChanged } from "../../../runelite/api/events";
import type { CharacterListPayload } from "../../../network/packet/ServerBinaryDecoder";
import { getSessionLoginFlags, send, sendHandshake, suppressReconnection, disposeServerConnection } from "../../../network/ServerConnection";
import { state as connection } from "../../../network/serverConnection/state";
import type { LoginProtocolExtension } from "../../../network/serverConnection/types/login";
import { LOGIN_FLAG_CHARACTER_SELECT } from "../../../network/serverConnection/constants";
import { CharacterPickerState } from "./CharacterPickerState";
import { CharacterListWait } from "./characterListWait";
import { decideCharacterList, decideCharacterResult, leaveRefusedReconnect } from "./characterFlow";
import { getCharacterSelectEnterAction, getCharacterRowAt, handleCharacterSelectClick, handlePickerKey } from "./pickerInput";
import { drawCharacterSelect } from "./pickerRender";
import { PICKER_FIELD_Y, PICKER_MAX_NAME_LENGTH } from "./pickerGeometry";
import type { PickerAction } from "./PickerAction";

export class CharactersPlugin extends Plugin implements LoginScreenExtension, LoginProtocolExtension {
    static descriptor: PluginDescriptor = {
        name: "Characters",
        description: "Character selection for worlds that enable it.",
        hidden: true,
        configKey: "charactersplugin",
    };
    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    readonly picker = new CharacterPickerState(this.client.loginState);
    private readonly characterListWait = new CharacterListWait();
    private pendingCharacterRequest?: { kind: "select" | "create" | "delete"; name: string };
    private enabledForConnection = false;
    private sessionCharacter: string | null = null;

    protected async startUp(): Promise<void> {
        if (connection.loginExtension) throw new Error("A login protocol extension is already registered");
        connection.loginExtension = this;
    }
    protected async shutDown(): Promise<void> {
        if (connection.loginExtension === this) connection.loginExtension = undefined;
        this.characterListWait.cancel();
        if (this.isPickerOpen()) {
            this.client.loginState.extension = undefined;
            suppressReconnection();
            disposeServerConnection("login plugin stopped");
            this.client.updateGameState(GameState.LOGIN_SCREEN);
        }
    }
    resetConnection(): void { this.enabledForConnection = false; this.characterListWait.cancel(); }
    loginAttempt(): void { this.sessionCharacter = null; }
    loginFlags(flags: number): number {
        return (flags & ~LOGIN_FLAG_CHARACTER_SELECT) | (this.enabledForConnection ? LOGIN_FLAG_CHARACTER_SELECT : 0);
    }
    handleMessage(msg: any): boolean {
        if (msg.type === "plugin_message" && msg.payload?.channel === "characters:slots") {
            const max = msg.payload.data?.maxPerAccount;
            if (!connection.lastWelcome && Number.isInteger(max) && max >= 2 && max <= 6) this.enabledForConnection = true;
            return true;
        }
        if (msg.type === "character_list") { this.onCharacterList(msg.payload); return true; }
        if (msg.type === "character_result") { this.onCharacterResult(msg.payload); return true; }
        return false;
    }
    beforeLoginHandshake(fallback: () => void): boolean {
        if (!this.isStarted()) return false;
        this.pendingCharacterRequest = undefined;
        this.characterListWait.onLoginAccepted(getSessionLoginFlags(), fallback);
        return true;
    }
    onGameStateChanged(_event: GameStateChanged): void {
        const state = this.client.gameState;
        if (state !== GameState.CONNECTING) this.characterListWait.cancel();
        if (state === GameState.LOGIN_SCREEN && this.isPickerOpen()) {
            this.client.loginState.extension = undefined;
            this.client.loginState.loginWithToken = false;
            this.client.loginState.promptCredentials(true);
            this.client.loginState.password = "";
            this.client.loginState.showRememberedLogin();
        } else if (state === GameState.LOGGED_IN || state === GameState.LOADING_GAME) {
            if (this.isPickerOpen()) this.client.loginState.extension = undefined;
        }
    }
    private isPickerOpen(): boolean { return this.client.loginState.extension === this; }
    private showPicker(payload: CharacterListPayload): void {
        this.picker.showCharacterSelect(payload);
        this.client.loginState.extension = this;
    }
    private sendCharacterSelect(name: string): void {
        this.sessionCharacter = name;
        send({ type: "character_select", payload: { name } });
    }
    draw(host: LoginRendererHost, ctx: RenderContext): void { drawCharacterSelect(host, ctx, this.picker); }
    click(host: LoginRendererHost, x: number, y: number): void {
        const action = handleCharacterSelectClick(host, this.picker, x, y);
        if (action) this.processAction(action);
    }
    key(key: string, char: string): boolean { return handlePickerKey(this.picker, key, char); }
    hover(host: LoginRendererHost, x: number, y: number): void { this.picker.hoveredCharacter = getCharacterRowAt(host, this.picker, x, y); }
    submit(): void {
        if (this.client.gameState === GameState.CONNECTING) this.processAction(getCharacterSelectEnterAction(this.picker));
    }
    textInput(): { value: string; y: number; setValue(value: string): void } | undefined {
        if (this.picker.pickerMode === "list") return undefined;
        return {
            value: this.picker.pickerInput,
            y: PICKER_FIELD_Y,
            setValue: (value) => { this.picker.pickerInput = value.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, PICKER_MAX_NAME_LENGTH); },
        };
    }
    hash(): string { return this.picker.pickerHash(); }

    /** CHARACTER_LIST: the picker for a login in progress, else a reconnect's re-select. */
    onCharacterList(payload: CharacterListPayload): void {
        const expected = this.characterListWait.onCharacterList();
        const state = this.picker;
        const decision = decideCharacterList({
            gameState: this.client.gameState,
            pickerOpen: this.isPickerOpen(),
            expected,
            sessionCharacter: this.sessionCharacter,
            characters: payload.characters,
            maxCharacters: payload.maxCharacters,
        });
        if (decision === "ignore") return;
        if (decision === "reselect" || decision === "select_default") {
            const name = decision === "select_default" ? payload.characters[payload.defaultIndex]?.name : this.sessionCharacter ?? payload.characters[payload.defaultIndex]?.name;
            if (!name) return;
            this.pendingCharacterRequest = { kind: "select", name };
            this.sendCharacterSelect(name);
            return;
        }
        if (decision === "reopen_picker") {
            this.pendingCharacterRequest = undefined;
            this.showPicker(payload);
            this.client.updateGameState(GameState.CONNECTING);
            return;
        }
        const refresh = this.isPickerOpen();
        const previous = refresh ? state.characters[state.selectedCharacter]?.name : undefined;
        const created = this.pendingCharacterRequest?.kind === "create" ? this.pendingCharacterRequest.name : undefined;
        this.showPicker(payload);
        // A refreshed list keeps the row the player was on, or moves to the one just made.
        const keep = payload.characters.findIndex(
            (c) => c.name.toLowerCase() === (created ?? previous ?? "").toLowerCase(),
        );
        if (refresh && keep >= 0) state.selectedCharacter = keep;
        this.pendingCharacterRequest = undefined;
    }

    /** CHARACTER_RESULT for the last select, create or delete. */
    onCharacterResult(result: { ok: boolean; code: number; message: string }): void {
        const state = this.picker;
        const request = this.pendingCharacterRequest;
        const decision = decideCharacterResult({ pending: request?.kind, ok: result.ok, gameState: this.client.gameState });
        if (decision === "ignore" || !request) return;
        state.pickerBusy = false;
        switch (decision) {
            case "abandon_reconnect":
                this.pendingCharacterRequest = undefined;
                this.client.loginState.extension = undefined;
                leaveRefusedReconnect(this.client.loginState, result.message, { suppressReconnection, disposeServerConnection });
                this.client.updateGameState(GameState.LOGIN_SCREEN);
                return;
            case "show_message":
                if (!this.isPickerOpen()) {
                    this.pendingCharacterRequest = undefined;
                    this.client.loginState.extension = undefined;
                    leaveRefusedReconnect(this.client.loginState, result.message, { suppressReconnection, disposeServerConnection });
                    this.client.updateGameState(GameState.LOGIN_SCREEN);
                    return;
                }
                this.pendingCharacterRequest = undefined;
                state.pickerMessage = result.message || "That isn't possible right now.";
                return;
            case "handshake":
                this.pendingCharacterRequest = undefined;
                state.pickerMessage = "";
                // Stays busy until the handshake puts the player in the world.
                state.pickerBusy = true;
                sendHandshake(request.name);
                return;
            case "back_to_list":
                // The character list that follows refreshes the rows (and clears the request).
                state.pickerMessage = "";
                state.pickerMode = "list";
                state.pickerInput = "";
                state.virtualKeyboardVisible = false;
                return;
        }
    }

    private processAction(action: PickerAction): void {
        switch (action.type) {
            case "select_character":
                if (action.index >= 0 && action.index < this.picker.characters.length) {
                    this.picker.selectedCharacter = action.index;
                    this.picker.pickerMessage = "";
                }
                return undefined;

            case "play_character": {
                const state = this.picker;
                const character = state.characters[state.selectedCharacter];
                if (state.pickerBusy || !character || this.client.gameState !== GameState.CONNECTING) return undefined;
                state.pickerBusy = true;
                state.pickerMessage = "";
                this.pendingCharacterRequest = { kind: "select", name: character.name };
                this.sendCharacterSelect(character.name);
                return undefined;
            }

            case "new_character":
                if (this.picker.pickerBusy || !this.picker.canCreateCharacter()) return undefined;
                this.picker.pickerMode = "create";
                this.picker.pickerInput = "";
                this.picker.pickerMessage = "";
                return undefined;

            case "delete_character": {
                const character = this.picker.characters[this.picker.selectedCharacter];
                if (this.picker.pickerBusy || !character || character.primary) return undefined;
                this.picker.pickerMode = "delete";
                this.picker.pickerInput = "";
                this.picker.pickerMessage = "";
                return undefined;
            }

            case "submit_picker_input": {
                const state = this.picker;
                const input = state.pickerInput.trim();
                if (state.pickerBusy || state.pickerMode === "list" || this.client.gameState !== GameState.CONNECTING) {
                    return undefined;
                }
                if (input.length === 0) {
                    state.pickerMessage = "Please enter a name.";
                    return undefined;
                }
                if (state.pickerMode === "create") {
                    this.pendingCharacterRequest = { kind: "create", name: input };
                    send({ type: "character_create", payload: { name: input } });
                } else {
                    const character = state.characters[state.selectedCharacter];
                    if (!character) return undefined;
                    this.pendingCharacterRequest = { kind: "delete", name: character.name };
                    send({ type: "character_delete", payload: { name: character.name, confirmName: input } });
                }
                state.pickerBusy = true;
                state.pickerMessage = "";
                return undefined;
            }

            case "cancel_picker_input":
                this.picker.pickerMode = "list";
                this.picker.pickerInput = "";
                this.picker.pickerMessage = "";
                this.picker.virtualKeyboardVisible = false;
                return undefined;

            case "sign_out_picker":
                // Drops the connection the picker holds open; the remembered login stays.
                this.characterListWait.cancel();
                this.pendingCharacterRequest = undefined;
                suppressReconnection();
                disposeServerConnection("character select sign out");
                this.client.updateGameState(GameState.LOGIN_SCREEN);
                return undefined;

        }
    }
}
