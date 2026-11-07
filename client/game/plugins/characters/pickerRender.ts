import type { CharacterPickerState } from "./CharacterPickerState";
import type { LoginRendererHost, RenderContext } from "../../login/renderer/host";
import { isCaretVisible } from "../../login/renderer/canvas";
import { drawButton, drawCenteredText, drawText, ellipsis, measureText, truncateFromStart } from "../../login/renderer/render/drawUtils";
import {
    getPickerRowCount,
    getPickerRowHeight,
    getPickerRowX,
    PICKER_BUTTON_Y,
    PICKER_FIELD_Y,
    PICKER_LEFT_BUTTON_DX,
    PICKER_MESSAGE_Y,
    PICKER_NO_SAVE_TEXT,
    PICKER_PROMPT_Y,
    PICKER_RIGHT_BUTTON_DX,
    PICKER_ROW_H,
    PICKER_ROW_W,
    PICKER_ROWS_Y,
    PICKER_SIGN_OUT_TEXT,
    PICKER_SIGN_OUT_Y,
    PICKER_TITLE_Y,
} from "./pickerGeometry";

/** "2d ago" style age of a last-played time; never-played characters say so. */
export function formatPlayedAgo(lastPlayedAt: number, now: number = Date.now()): string {
    if (!lastPlayedAt) return "Not played yet";
    const minutes = Math.max(0, Math.floor((now - lastPlayedAt) / 60_000));
    if (minutes < 1) return "Played just now";
    if (minutes < 60) return `Played ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Played ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 365) return `Played ${days}d ago`;
    return `Played ${Math.floor(days / 365)}y ago`;
}

function drawDimmedButton(host: LoginRendererHost, ctx: RenderContext, centerX: number, centerY: number, text: string) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawButton(host, ctx, centerX, centerY, text);
    ctx.restore();
}

/** The character picker: the account's characters on this server, or a name field. */
export function drawCharacterSelect(host: LoginRendererHost, ctx: RenderContext, state: CharacterPickerState) {
    if (!host.fontBold12 || !host.fontPlain12) return;
    const centerX = host.loginBoxX + 180;
    const small = host.fontPlain11 ?? host.fontPlain12;

    // In the list the title line carries the server's refusal or the wait: the rows fill the box.
    if (state.pickerMode === "list" && state.pickerMessage) {
        drawCenteredText(host, ctx, host.fontPlain12, state.pickerMessage, centerX, PICKER_TITLE_Y, 0xff0000, true);
    } else if (state.pickerMode === "list" && state.pickerBusy) {
        drawCenteredText(host, ctx, host.fontBold12, "Please wait...", centerX, PICKER_TITLE_Y, 0xffffff, true);
    } else {
        drawCenteredText(host, ctx, host.fontBold12, "Choose your character", centerX, PICKER_TITLE_Y, 0xffff00, true);
    }

    if (state.pickerMode === "list") {
        const rows = getPickerRowCount(state);
        const rowH = getPickerRowHeight(rows);
        const rowX = getPickerRowX(host);
        const twoLines = rowH >= PICKER_ROW_H;
        for (let i = 0; i < rows; i++) {
            const ry = PICKER_ROWS_Y + i * rowH;
            const character = state.characters[i];
            const usable = character !== undefined || state.canCreateCharacter();
            if (character && i === state.selectedCharacter) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
                ctx.fillRect(rowX, ry, PICKER_ROW_W, rowH - 1);
            } else if (usable && i === state.hoveredCharacter) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
                ctx.fillRect(rowX, ry, PICKER_ROW_W, rowH - 1);
            }
            const nameY = ry + Math.floor(rowH / 2) + 5;
            if (!character) {
                if (usable) {
                    drawText(host, ctx, host.fontBold12, "New character", rowX + 6, nameY, 0xc8c8c8, true);
                } else {
                    drawCenteredText(host, ctx, small, PICKER_NO_SAVE_TEXT, centerX, nameY, 0xc0c0c0, true);
                }
                continue;
            }
            const color = i === state.selectedCharacter ? 0xffff00 : 0xffffff;
            const stats = `Combat lvl ${character.combatLevel} · Total ${character.totalLevel}`;
            const right = rowX + PICKER_ROW_W - 6;
            const statsW = measureText(host, host.fontPlain12, stats);
            drawText(host, ctx, host.fontBold12, ellipsis(host, character.name, PICKER_ROW_W - statsW - 18), rowX + 6, nameY, color, true);
            if (twoLines) {
                drawText(host, ctx, host.fontPlain12, stats, right - statsW, ry + 11, 0xffffff, true);
                const played = formatPlayedAgo(character.lastPlayedAt);
                drawText(host, ctx, small, played, right - measureText(host, small, played), ry + 22, 0xd0d0d0, true);
            } else {
                drawText(host, ctx, host.fontPlain12, stats, right - statsW, nameY, 0xffffff, true);
            }
        }

        drawButton(host, ctx, host.loginBoxX + PICKER_LEFT_BUTTON_DX, PICKER_BUTTON_Y, "Play");
        const selected = state.characters[state.selectedCharacter];
        if (selected && !selected.primary) {
            drawButton(host, ctx, host.loginBoxX + PICKER_RIGHT_BUTTON_DX, PICKER_BUTTON_Y, "Delete");
        } else {
            drawDimmedButton(host, ctx, host.loginBoxX + PICKER_RIGHT_BUTTON_DX, PICKER_BUTTON_Y, "Delete");
        }
    } else {
        const creating = state.pickerMode === "create";
        const prompt = creating
            ? "Name your new character:"
            : `Type ${state.characters[state.selectedCharacter]?.name ?? ""} to delete it:`;
        drawCenteredText(host, ctx, host.fontBold12, prompt, centerX, PICKER_PROMPT_Y, 0xffff00, true);
        const caret = isCaretVisible(host) ? "|" : "";
        drawText(
            host,
            ctx,
            host.fontBold12,
            "Name: " + truncateFromStart(host, state.pickerInput, 195) + caret,
            centerX - 108,
            PICKER_FIELD_Y,
            0xffffff,
            true,
        );
        if (state.pickerMessage) {
            drawCenteredText(host, ctx, host.fontPlain12, state.pickerMessage, centerX, PICKER_MESSAGE_Y, 0xff0000, true);
        } else if (state.pickerBusy) {
            drawCenteredText(host, ctx, host.fontPlain12, "Please wait...", centerX, PICKER_MESSAGE_Y, 0xffffff, true);
        }
        drawButton(host, ctx, host.loginBoxX + PICKER_LEFT_BUTTON_DX, PICKER_BUTTON_Y, creating ? "Create" : "Delete");
        drawButton(host, ctx, host.loginBoxX + PICKER_RIGHT_BUTTON_DX, PICKER_BUTTON_Y, "Cancel");
    }

    drawCenteredText(host, ctx, host.fontPlain12, PICKER_SIGN_OUT_TEXT, centerX, PICKER_SIGN_OUT_Y + 4, 0xffffff, true);
}
