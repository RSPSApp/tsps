/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ./LICENSE.
 */
import * as SpriteID from "@runelite/api/gameval/SpriteID";
import { Color } from "@runelite/awt/Color";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { Text } from "@runelite/client/util/Text";
import { IndexType } from "../../../rs/cache/IndexType";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import type { MenuActionData } from "../../../ui/menu/menuEvents";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, WidgetOverlay } from "../ClientPluginManager";
import { COMBINATIONS, type Combination, LightBox, type LightboxSolution, LightboxSolver, LightboxState } from "./lightbox/Lightbox";
import { PuzzleSolverConfig } from "./PuzzleSolverConfig";
import { LIGHT_PUZZLE_BUTTONS, LIGHT_PUZZLE_LIGHTS, LIGHT_PUZZLE_STEEL_BORDER, VM_NATHIS_ANSWERS, VM_NATHIS_QUESTION } from "./PuzzleSolverInterfaces";
import { PuzzleSolverOverlay } from "./PuzzleSolverOverlay";
import { createSolveBackend, type PuzzleSolveBackend } from "./solver/PuzzleSolveBackend";
import { correctMuseumAnswer } from "./VarrockMuseumAnswer";

/** RuneLite's CORRECT_MUSEUM_PUZZLE_ANSWER_COLOR, new Color(0, 248, 128). */
const CORRECT_MUSEUM_PUZZLE_ANSWER_COLOR = "00f880";

/** What a test hands the plugin instead of the injector's singletons. */
export type PuzzleSolverPluginDeps = {
    client?: OsrsClient;
    configManager?: ConfigManager;
    solveBackend?: PuzzleSolveBackend;
};

/**
 * RuneLite's Puzzle Solver: the moves to solve sliding puzzle boxes (treasure trails, and Monkey
 * Madness I's puzzle), the switches that solve a light box, and the right answer at the Varrock
 * Museum's Natural History quiz.
 */
export class PuzzleSolverPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Puzzle Solver",
        description: "Show you where to click to solve puzzle boxes",
        tags: ["clues", "scrolls", "overlay"],
        enabledByDefault: false,
        configKey: "puzzlesolverplugin",
    };

    static config = PuzzleSolverConfig;

    readonly osrsClient: OsrsClient;
    readonly client: ClientImpl;
    readonly config: ReturnType<ConfigManager["getConfig"]>;
    private readonly solveBackendOverride?: PuzzleSolveBackend;
    private solveBackend: PuzzleSolveBackend | null = null;
    private readonly overlay: PuzzleSolverOverlay;
    private arrows: (HTMLCanvasElement | null)[] | null = null;

    private lightbox: LightboxState | null = null;
    private readonly changes: (LightboxState | null)[] = new Array(LightBox.COMBINATIONS_POWER).fill(null);
    private lastClick: Combination | null = null;
    private lastClickInvalid = false;

    constructor(deps?: PuzzleSolverPluginDeps) {
        super();
        this.osrsClient = deps?.client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client = new ClientImpl(this.osrsClient);
        this.config = (deps?.configManager ?? inject(ConfigManager)).getConfig(PuzzleSolverConfig);
        this.solveBackendOverride = deps?.solveBackend;
        const plugin = this;
        this.overlay = new PuzzleSolverOverlay({
            getClient: () => plugin.client,
            displaySolution: () => plugin.config.displaySolution() === true,
            displayRemainingMoves: () => plugin.config.displayRemainingMoves() === true,
            drawDots: () => plugin.config.drawDots() === true,
            movesToShow: () => Math.min(8, Math.max(4, Number(plugin.config.movesToShow()) | 0)),
            dotColor: () => Color.fromArgb(Number(plugin.config.dotColor()) >>> 0, false),
            dotEndColor: () => Color.fromArgb(Number(plugin.config.dotEndColor()) >>> 0, false),
            getSolveBackend: () => plugin.getSolveBackend(),
            getArrow: (quarterTurns) => plugin.getArrow(quarterTurns),
        });
    }

    // ------------------------------------------------------------------ lifecycle

    protected async shutDown(): Promise<void> {
        this.overlay.reset();
        this.solveBackend?.dispose();
        this.solveBackend = null;
        this.resetLightbox();
    }

    /** RuneLite's overlayManager.add(overlay), while the plugin runs. */
    widgetOverlays(): WidgetOverlay[] {
        return this.isStarted() ? [this.overlay] : [];
    }

    getSolveBackend(): PuzzleSolveBackend {
        if (this.solveBackendOverride) return this.solveBackendOverride;
        return (this.solveBackend ??= createSolveBackend());
    }

    // ------------------------------------------------------------------ events

    onMenuOptionClicked(action: MenuActionData): boolean {
        if (!this.isStarted()) return false;
        const index = LIGHT_PUZZLE_BUTTONS.indexOf(action.param1 | 0);
        if (index < 0) return false;
        const combination = COMBINATIONS[index];
        // Two presses before the lights change can't be told apart: skip the next change.
        if (this.lastClick !== null) this.lastClickInvalid = true;
        else this.lastClick = combination;
        return false;
    }

    onGameTick(): void {
        if (!this.isStarted()) return;
        this.highlightMuseumAnswer();
        this.updateLightbox();
    }

    // ------------------------------------------------------------------ Varrock Museum

    /**
     * RuneLite colours the right answer when vm_natural_history loads. Here the group mounts before
     * the server's question and answer strings arrive, so it is checked each tick while open; an
     * answer already coloured is left alone.
     */
    private highlightMuseumAnswer(): void {
        const manager = this.osrsClient.widgetManager;
        const question: WidgetNode | undefined = manager?.getWidgetByUid(VM_NATHIS_QUESTION);
        if (!manager || !question) return;
        const answer = correctMuseumAnswer(String(question.text ?? ""));
        if (answer === undefined) return;
        for (const uid of VM_NATHIS_ANSWERS) {
            const widget: WidgetNode | undefined = manager.getWidgetByUid(uid);
            const text = String(widget?.text ?? "");
            if (!widget || text !== answer) continue;
            if (text === Text.removeTags(text)) {
                widget.text = `<col=${CORRECT_MUSEUM_PUZZLE_ANSWER_COLOR}>${text}</col>`;
                manager.invalidateWidgetRender(widget, "puzzle-solver");
            }
            return;
        }
    }

    // ------------------------------------------------------------------ light box

    private resetLightbox(): void {
        this.lastClick = null;
        this.lastClickInvalid = false;
        this.lightbox = null;
        this.changes.fill(null);
    }

    private updateLightbox(): void {
        const lightboxWidget = this.client.getWidget(LIGHT_PUZZLE_LIGHTS);
        if (lightboxWidget === null) {
            if (this.lightbox !== null) this.resetLightbox();
            return;
        }

        // Get current state from widget
        const lightboxState = new LightboxState();
        lightboxWidget.getDynamicChildren().forEach((light, index) => {
            if (index >= LightBox.WIDTH * LightBox.HEIGHT) return;
            lightboxState.setState(Math.floor(index / LightBox.WIDTH), index % LightBox.HEIGHT, light.getItemId() === LightBox.LIGHT_BULB_ON);
        });

        if (lightboxState.equals(this.lightbox)) return; // no change

        const prev = this.lightbox;
        this.lightbox = lightboxState;

        if (this.lastClick === null || this.lastClickInvalid || prev === null) {
            this.lastClick = null;
            this.lastClickInvalid = false;
            return;
        }

        this.changes[COMBINATIONS.indexOf(this.lastClick)] = lightboxState.diff(prev);
        this.lastClick = null;

        // Try to solve
        const solver = new LightboxSolver();
        solver.setInitial(lightboxState);
        this.changes.forEach((state, index) => {
            if (state !== null) solver.setSwitchChange(COMBINATIONS[index], state);
        });
        this.setLightboxTitle(solver.solve());
    }

    /** The light box's title, the steel border's second child (RuneLite's getChild(1)). */
    private setLightboxTitle(solution: LightboxSolution | null): void {
        const manager = this.osrsClient.widgetManager;
        const border = manager?.getWidgetByUid(LIGHT_PUZZLE_STEEL_BORDER);
        const title: WidgetNode | undefined = border ? manager.getDynamicChildrenByParent(border)[1] : undefined;
        if (!title) return;
        const text = solution !== null && solution.numMoves() > 0 ? `Light box - Solution: ${solution}`
            : solution !== null ? "Light box - Solution: solved!"
            : "Light box - Solution: unknown";
        if (title.text === text) return;
        title.text = text;
        manager.invalidateWidgetRender(title, "puzzle-solver");
    }

    // ------------------------------------------------------------------ arrows

    /** SpriteManager.getSprite(MAPMARKER, 1), and ImageUtil.rotateImage of it. */
    private getArrow(quarterTurns: 0 | 1 | 2 | 3): HTMLCanvasElement | null {
        if (this.arrows === null) {
            // Not cached until it loads, so a cache that is not ready yet is asked again next frame.
            const down = this.loadDownArrow();
            if (!down) return null;
            this.arrows = [0, 1, 2, 3].map((turns) => rotateQuarterTurns(down, turns));
        }
        return this.arrows[quarterTurns];
    }

    private loadDownArrow(): HTMLCanvasElement | null {
        if (typeof document === "undefined") return null;
        try {
            const index = this.osrsClient.cacheSystem?.getIndex(IndexType.DAT2.sprites);
            const frames = index ? SpriteLoader.loadIntoIndexedSprites(index, SpriteID.MAPMARKER) : undefined;
            const frame = frames?.[1];
            return frame ? spriteToCanvas(frame) : null;
        } catch {
            return null;
        }
    }
}

/** The image turned clockwise by `turns` quarter turns. */
function rotateQuarterTurns(image: HTMLCanvasElement, turns: number): HTMLCanvasElement {
    if (turns === 0) return image;
    const sideways = turns % 2 === 1;
    const canvas = document.createElement("canvas");
    canvas.width = sideways ? image.height : image.width;
    canvas.height = sideways ? image.width : image.height;
    const context = canvas.getContext("2d");
    if (!context) return image;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turns * Math.PI) / 2);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    return canvas;
}
