import { boldFont, overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { CombatLevelPlugin } from "./CombatLevelPlugin";
import { combatLevel } from "./CombatLevel";

type Rect = { x: number; y: number; w: number; h: number };
const BG: [number, number, number, number] = [0.12, 0.1, 0.07, 0.96];
const BORDER: [number, number, number, number] = [0.62, 0.52, 0.34, 0.95];
const COMBAT_LEVEL_COLOUR = 0xff981f;

export function positionCombatTooltip(anchor: Rect, mouse: { x: number; y: number }, canvas: { w: number; h: number }, size: { w: number; h: number }): Rect {
    let x = anchor.x + anchor.w + 6;
    if (x + size.w > canvas.w - 2) x = anchor.x - size.w - 6;
    if (x < 2) x = Math.max(2, Math.min(mouse.x + 12, canvas.w - size.w - 2));
    let y = anchor.y + anchor.h / 2 - size.h / 2;
    y = Math.max(2, Math.min(y, canvas.h - size.h - 2));
    return { x, y, w: Math.min(size.w, canvas.w - 4), h: Math.min(size.h, canvas.h - 4) };
}

/** RuneLite-style next-level tooltip anchored to the Combat Options level text. */
export class CombatLevelOverlay implements WidgetOverlay {
    constructor(private readonly plugin: CombatLevelPlugin) {}

    private snapshot(): { target: any; lines: string[]; rect: Rect; sx: number; sy: number } | undefined {
        if (!this.plugin.isStarted() || !this.plugin.getConfig().showLevelsUntil()) return undefined;
        const client: any = this.plugin.getClient();
        const manager = client.widgetManager;
        const levels = this.plugin.getLevels();
        const mx = Number(client.inputManager?.mouseX), my = Number(client.inputManager?.mouseY);
        if (!manager || !levels || !Number.isFinite(mx) || !Number.isFinite(my) || mx < 0 || my < 0 || client.menuOpen === true) return undefined;
        if (combatLevel(levels) >= 126) return undefined;

        const widget = manager.getWidgetByUid?.((593 << 16) | 4);
        let target: any;
        if (widget && !manager.isEffectivelyHidden?.(widget.uid) && /^Combat Lvl:\s*\d+(?:\.\d+)?$/.test(String(widget.text ?? ""))) {
            const rect = { x: Number(widget._absX), y: Number(widget._absY), w: Number(widget._absWidth), h: Number(widget._absHeight) };
            if (rect.w > 0 && rect.h > 0 && mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h) target = { widget, rect };
        }
        if (!target) return undefined;
        const changes = this.plugin.getNextLevels(levels);
        const names: Record<string, string> = {
            melee: "Attack/Strength",
            defenceHitpoints: "Defence/Hitpoints",
            ranged: "Ranged",
            magic: "Magic",
            prayer: "Prayer",
        };
        const lines = Object.entries(changes).map(([group, count]) => `${count} ${names[group]}`);
        if (!lines.length) return undefined;
        const scaleX = target.rect.w / Math.max(1, Number(target.widget.width) || target.rect.w);
        const scaleY = target.rect.h / Math.max(1, Number(target.widget.height) || target.rect.h);
        return { target: target.widget, lines, rect: target.rect, sx: scaleX, sy: scaleY };
    }

    signature(): string {
        const s = this.snapshot();
        if (!s) return "";
        const client: any = this.plugin.getClient();
        return `${s.rect.x}:${s.rect.y}:${s.rect.w}:${s.rect.h}:${client.inputManager.mouseX}:${client.inputManager.mouseY}:${s.lines.join("|")}:${this.plugin.getConfig().showLevelsUntil()}`;
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const s = this.snapshot();
        if (!s) return [];
        const renderer: any = context.renderer;
        // A tooltip: the tooltip font (its heading bold), the box sized to it.
        const font = overlayFont("tooltip");
        const heading = boldFont(font);
        const sx = s.sx * font.scale, sy = s.sy * font.scale;
        const width = 152 * sx;
        const height = (28 + s.lines.length * 16) * sy;
        const mouse = (this.plugin.getClient() as any).inputManager;
        const box = positionCombatTooltip(s.rect, { x: mouse.mouseX, y: mouse.mouseY },
            { w: renderer.canvas.width, h: renderer.canvas.height }, { w: width, h: height });
        renderer.drawRect(box.x, box.y, box.w, box.h, BG);
        renderer.drawRect(box.x, box.y, box.w, 1, BORDER);
        renderer.drawRect(box.x, box.y + box.h - 1, box.w, 1, BORDER);
        drawTextGL(renderer, context.fontLoader, "Next combat level:", box.x + 8 * sx, box.y + 5 * sy,
            box.w - 16 * sx, 16 * sy, heading.id, COMBAT_LEVEL_COLOUR, 0, 0, true, 1, undefined, sx, sy);
        s.lines.forEach((line, i) => drawTextGL(renderer, context.fontLoader, line, box.x + 8 * sx,
            box.y + (24 + i * 16) * sy, box.w - 16 * sx, 16 * sy, font.id, 0xffffff, 0, 0, true, 1, undefined, sx, sy));
        return [box];
    }
}
