/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * Copyright (c) 2018, Henke <https://github.com/henke96>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ./LICENSE.
 */
import { GameState } from "@runelite/api/GameState";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import type { Item } from "@runelite/api/Item";
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { Polygon, Rectangle } from "@runelite/awt/Shapes";
import { BackgroundComponent } from "@runelite/client/ui/overlay/components/BackgroundComponent";
import { TextComponent } from "@runelite/client/ui/overlay/components/TextComponent";
import type { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { ClueScrollDynamicOverlay } from "../cluescrolls/ClueScrollDynamicOverlay";
import { TRAIL_SLIDEPUZZLE_PIECES } from "./PuzzleSolverInterfaces";
import type { PuzzleSolveBackend } from "./solver/PuzzleSolveBackend";
import { BLANK_TILE_VALUE, DIMENSION, PuzzleSolver } from "./solver/PuzzleSolver";
import { PuzzleState } from "./solver/PuzzleState";

const INFO_BOX_WIDTH = 100;
const INFO_BOX_OFFSET_Y = 50;
const INFO_BOX_TOP_BORDER = 2;
const INFO_BOX_BOTTOM_BORDER = 2;

const PUZZLE_TILE_SIZE = 50;
const DOT_MARKER_MAX_SIZE = 24;
const DOT_MARKER_MIN_SIZE = 4;

/** What the overlay reads from the plugin: the client, its settings, the solver thread and arrows. */
export type PuzzleSolverOverlayHost = {
    getClient(): ClientImpl;
    displaySolution(): boolean;
    displayRemainingMoves(): boolean;
    drawDots(): boolean;
    movesToShow(): number;
    dotColor(): Color;
    dotEndColor(): Color;
    getSolveBackend(): PuzzleSolveBackend;
    /** The down arrow (sprite MAPMARKER, frame 1), rotated by `quarterTurns` clockwise; null until loaded. */
    getArrow(quarterTurns: 0 | 1 | 2 | 3): HTMLCanvasElement | null;
};

/** RuneLite's ColorUtil.colorLerp. */
export function colorLerp(a: Color, b: Color, t: number): Color {
    const lerp = (x: number, y: number) => Math.trunc(x + (y - x) * t);
    return new Color(lerp(a.getRed(), b.getRed()), lerp(a.getGreen(), b.getGreen()), lerp(a.getBlue(), b.getBlue()), lerp(a.getAlpha(), b.getAlpha()));
}

/** An oval outline as a polygon, for java.awt's drawOval (Graphics2D here has no ovals to stroke). */
function ovalOutline(x: number, y: number, width: number, height: number): Polygon {
    const points: [number, number][] = [];
    const cx = x + width / 2, cy = y + height / 2, rx = width / 2, ry = height / 2;
    const segments = 24;
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
    }
    return new Polygon(points);
}

/**
 * The sliding puzzle's solution over the board (RuneLite's PuzzleSolverOverlay, DYNAMIC and above
 * widgets): the next moves as dots or arrows on the slots to click, and a moves-left box above.
 */
export class PuzzleSolverOverlay extends ClueScrollDynamicOverlay {
    private solver: PuzzleSolver | null = null;
    private cancelSolve: (() => void) | null = null;
    private cachedItems: number[] | null = null;

    constructor(private readonly host: PuzzleSolverOverlayHost) {
        super("PuzzleSolverOverlay");
    }

    /** The board the last signature pass saw (see signature()). */
    private boardKey = "";

    /**
     * RuneLite checks for a stale solution every frame; here the live pass (which starts a new
     * solve) runs only when the signature changes. The board is part of the signature, so a slide
     * while "Solving.." still reaches the live pass and its re-solve check.
     */
    signature(): string {
        const signature = super.signature();
        return signature === "" ? "" : `${signature}|${this.boardKey}`;
    }

    /** Drops the solver; the next frame with a puzzle open solves again. */
    reset(): void {
        this.cancelSolve?.();
        this.cancelSolve = null;
        this.solver = null;
        this.cachedItems = null;
    }

    protected render(graphics: Graphics2D, live: boolean): void {
        const host = this.host;
        const client = host.getClient();
        if ((!host.displaySolution() && !host.displayRemainingMoves()) || client.getGameState() !== GameState.LOGGED_IN) return;

        let useNormalSolver = true;
        let container = client.getItemContainer(InventoryID.TRAIL_PUZZLEINV);
        if (container === null) {
            useNormalSolver = false;
            container = client.getItemContainer(InventoryID.REINITIALISATION_INV);
            if (container === null) return;
        }

        const puzzleBox = client.getWidget(TRAIL_SLIDEPUZZLE_PIECES);
        if (puzzleBox === null || puzzleBox.isHidden()) return;
        const puzzleBoxLocation = puzzleBox.getCanvasLocation();
        if (puzzleBoxLocation === null) return;

        let infoString: string | null = "Solving..";
        const itemIds = getItemIds(container.getItems(), useNormalSolver);
        if (itemIds === null) return;
        if (!live) this.boardKey = itemIds.join(",");
        // RuneLite's fixed 50px tiles, 100px box and dot sizes, scaled to the board as drawn.
        const scale = puzzleBox.getWidth() / (DIMENSION * PUZZLE_TILE_SIZE) || 1;
        let shouldCache = false;
        const solver = this.solver;

        if (solver !== null) {
            if (solver.hasFailed()) {
                infoString = "The puzzle could not be solved";
            } else if (solver.hasSolution()) {
                const found = findPosition(solver, itemIds);
                if (found !== null) {
                    const position = found.position;
                    // Only the real draw moves the solver along; the signature pass just looks.
                    if (live) solver.setPosition(position);
                    if (found.moved) shouldCache = true;
                    const stepsLeft = solver.getStepCount() - position - 1;
                    if (stepsLeft === 0) infoString = "Solved!";
                    else if (host.displayRemainingMoves()) infoString = `Moves left: ${stepsLeft}`;
                    else infoString = null;

                    if (host.displaySolution()) {
                        if (host.drawDots()) this.drawDots(graphics, solver, position, puzzleBoxLocation, scale);
                        else this.drawArrows(graphics, solver, position, puzzleBoxLocation, scale);
                    }
                }
            }
        }

        // Draw info box
        if (infoString !== null) {
            const fm = graphics.getFontMetrics();
            // Never narrower than the text, which the overlay renderer may draw larger.
            const width = Math.max(Math.round(INFO_BOX_WIDTH * scale), fm.stringWidth(infoString) + 8);
            const x = puzzleBoxLocation.x + Math.trunc(puzzleBox.getWidth() / 2) - Math.trunc(width / 2);
            const y = puzzleBoxLocation.y - Math.round(INFO_BOX_OFFSET_Y * scale);
            const height = INFO_BOX_TOP_BORDER + fm.getHeight() + INFO_BOX_BOTTOM_BORDER;

            const backgroundComponent = new BackgroundComponent();
            backgroundComponent.setRectangle(new Rectangle(x, y, width, height));
            backgroundComponent.render(graphics);

            const textComponent = new TextComponent();
            textComponent.setPosition({ x: x + Math.trunc((width - fm.stringWidth(infoString)) / 2), y: y + fm.getHeight() });
            textComponent.setText(infoString);
            textComponent.render(graphics);
        }

        if (!live) return;

        // Solve the puzzle if we don't have an up to date solution
        if (solver === null || this.cachedItems === null
            || (!shouldCache && solver.hasExceededWaitDuration() && !sameItems(this.cachedItems, itemIds))) {
            this.solve(itemIds, useNormalSolver);
            shouldCache = true;
        }
        if (shouldCache) this.cachedItems = itemIds.slice();
    }

    private drawDots(graphics: Graphics2D, solver: PuzzleSolver, position: number, origin: { x: number; y: number }, scale: number): void {
        const host = this.host;
        const tile = PUZZLE_TILE_SIZE * scale;
        const movesToShow = Math.max(2, host.movesToShow());
        // Display the next movesToShow steps
        for (let i = 1; i <= movesToShow; i++) {
            const j = position + i;
            if (j >= solver.getStepCount()) break;
            const futureMove = solver.getStep(j);
            if (futureMove === null) break;

            const blankX = futureMove.getEmptyPiece() % DIMENSION;
            const blankY = Math.floor(futureMove.getEmptyPiece() / DIMENSION);
            const numerator = (i - 1) * (DOT_MARKER_MAX_SIZE - DOT_MARKER_MIN_SIZE);
            const markerSize = Math.round((DOT_MARKER_MAX_SIZE - numerator / (movesToShow - 1)) * scale);

            const x = Math.round(origin.x + blankX * tile + tile / 2) - Math.trunc(markerSize / 2) - 1;
            const y = Math.round(origin.y + blankY * tile + tile / 2) - Math.trunc(markerSize / 2) - 1;

            graphics.setColor(colorLerp(host.dotColor(), host.dotEndColor(), (i - 1) / (movesToShow - 1)));
            graphics.fillOval(x, y, markerSize, markerSize);
            graphics.setColor(Color.BLACK);
            graphics.draw(ovalOutline(x - 1, y - 1, markerSize + 1, markerSize + 1));
        }
    }

    private drawArrows(graphics: Graphics2D, solver: PuzzleSolver, position: number, origin: { x: number; y: number }, scale: number): void {
        const tile = PUZZLE_TILE_SIZE * scale;
        // Find the current blank tile position
        const currentMove = solver.getStep(position);
        if (currentMove === null) return;
        let lastBlankX = currentMove.getEmptyPiece() % DIMENSION;
        let lastBlankY = Math.floor(currentMove.getEmptyPiece() / DIMENSION);

        // Display the next 3 steps
        for (let i = 1; i < 4; i++) {
            const j = position + i;
            if (j >= solver.getStepCount()) break;
            const futureMove = solver.getStep(j);
            if (futureMove === null) break;

            const blankX = futureMove.getEmptyPiece() % DIMENSION;
            const blankY = Math.floor(futureMove.getEmptyPiece() / DIMENSION);
            const xDelta = blankX - lastBlankX;
            const yDelta = blankY - lastBlankY;
            // The down arrow turned clockwise: a quarter points left, three quarters right.
            const arrow = this.host.getArrow(xDelta > 0 ? 3 : xDelta < 0 ? 1 : yDelta > 0 ? 0 : 2);
            if (arrow !== null) {
                const x = Math.round(origin.x + blankX * tile + tile / 2) - Math.trunc(arrow.width / 2) - 1;
                const y = Math.round(origin.y + blankY * tile + tile / 2) - Math.trunc(arrow.height / 2) - 1;
                graphics.drawImage(arrow, x, y);
            }
            lastBlankX = blankX;
            lastBlankY = blankY;
        }
    }

    private solve(items: readonly number[], useNormalSolver: boolean): void {
        this.cancelSolve?.();
        const solver = new PuzzleSolver(null, new PuzzleState(items));
        this.solver = solver;
        solver.start();
        this.cancelSolve = this.host.getSolveBackend().solve(items, !useNormalSolver, (steps) => {
            if (this.solver === solver) {
                solver.finish(steps);
                this.cancelSolve = null;
            }
        });
    }
}

/**
 * The solution step the board is on, as RuneLite looks for it: the stored step and the next 5
 * (the player moved along), then the 5 before it (the player went back). `moved` is true when
 * the step is not the stored one. Null when the player left the solution's path.
 */
function findPosition(solver: PuzzleSolver, itemIds: readonly number[]): { position: number; moved: boolean } | null {
    for (let i = 0; i < 6; i++) {
        const j = solver.getPosition() + i;
        if (j === solver.getStepCount()) break;
        // If this is false, player has moved the empty tile
        if (solver.getStep(j)?.hasPieces(itemIds)) return { position: j, moved: i > 0 };
    }
    for (let i = 1; i < 6; i++) {
        const j = solver.getPosition() - i;
        if (j < 0) break;
        if (solver.getStep(j)?.hasPieces(itemIds)) return { position: j, moved: true };
    }
    return null;
}

function sameItems(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * The board as the solver numbers it: 0 for the lowest piece id upwards, the blank as -1. RuneLite
 * adds the blank when the container ends before the last slot. Null when the container has no
 * single blank (a board the solver cannot take).
 */
export function getItemIds(items: readonly Item[], useNormalSolver: boolean): number[] | null {
    const itemIds = new Array<number>(DIMENSION * DIMENSION).fill(BLANK_TILE_VALUE);
    for (let i = 0; i < items.length && i < itemIds.length; i++) itemIds[i] = items[i].getId() < 0 ? BLANK_TILE_VALUE : items[i].getId();
    if (itemIds.filter((id) => id === BLANK_TILE_VALUE).length !== 1) return null;
    return convertToSolverFormat(itemIds, useNormalSolver);
}

function convertToSolverFormat(items: readonly number[], useNormalSolver: boolean): number[] {
    let lowestId = Number.MAX_SAFE_INTEGER;
    for (const id of items) if (id !== BLANK_TILE_VALUE && lowestId > id) lowestId = id;
    return items.map((id) => {
        if (id === BLANK_TILE_VALUE) return BLANK_TILE_VALUE;
        const value = id - lowestId;
        // The MM puzzle has gaps
        return useNormalSolver ? value : Math.trunc(value / 2);
    });
}
