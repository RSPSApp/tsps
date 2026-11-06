/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */
import { IDAStar, type Pathfinder } from "./IDAStar";
import { IDAStarMM } from "./IDAStarMM";
import { ManhattanDistance } from "./ManhattanDistance";
import { PuzzleState } from "./PuzzleState";

export { BLANK_TILE_VALUE, DIMENSION } from "./PuzzleState";

/** How long a solution is trusted before a changed board is solved again. */
const MAX_WAIT_DURATION_MS = 1500;

/** The pathfinder for a board: IDA* for puzzle boxes, the row-by-row solver for Monkey Madness I. */
export function createPathfinder(monkeyMadness: boolean): Pathfinder {
    return monkeyMadness ? new IDAStarMM(new ManhattanDistance()) : new IDAStar(new ManhattanDistance());
}

/** Solves one board and remembers where the player is along the solution (RuneLite's PuzzleSolver). */
export class PuzzleSolver {
    private solution: PuzzleState[] | null = null;
    private position = 0;
    private startedAt: number | null = null;
    private failed = false;

    constructor(
        private readonly pathfinder: Pathfinder | null,
        private readonly startState: PuzzleState,
        private readonly now: () => number = () => Date.now(),
    ) {}

    getStep(stepIdx: number): PuzzleState | null {
        return this.solution?.[stepIdx] ?? null;
    }

    getStepCount(): number {
        return this.solution?.length ?? 0;
    }

    hasSolution(): boolean {
        return this.solution !== null;
    }

    getPosition(): number {
        return this.position;
    }

    setPosition(position: number): void {
        this.position = position;
    }

    hasExceededWaitDuration(): boolean {
        return this.startedAt !== null && this.now() - this.startedAt > MAX_WAIT_DURATION_MS;
    }

    hasFailed(): boolean {
        return this.failed;
    }

    getStartState(): PuzzleState {
        return this.startState;
    }

    /** RuneLite's run(): marks the start, then computes the path on this thread. */
    run(): void {
        this.start();
        if (!this.pathfinder) throw new Error("No pathfinder to run");
        let path: PuzzleState[] | null = null;
        try {
            path = this.pathfinder.computePath(this.startState);
        } catch {
            path = null;
        }
        this.finish(path?.map((step) => step.getPieces()) ?? null);
    }

    /** The solve began (on a worker, or inline). */
    start(): void {
        this.startedAt = this.now();
    }

    /** The solve ended: each step's pieces, or null when it found no path. */
    finish(steps: ReadonlyArray<readonly number[]> | null): void {
        this.solution = steps ? steps.map((pieces) => new PuzzleState(pieces)) : null;
        this.failed = this.solution === null;
    }
}
