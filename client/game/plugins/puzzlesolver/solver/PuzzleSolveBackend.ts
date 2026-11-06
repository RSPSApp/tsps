import { IDAStar, SearchBudgetExceeded } from "./IDAStar";
import { ManhattanDistance } from "./ManhattanDistance";
import { createPathfinder } from "./PuzzleSolver";
import { PuzzleState } from "./PuzzleState";

/** The boards from start to goal, or null when the solve failed. */
export type PuzzleSolveResult = number[][] | null;

export type PuzzleSolveRequest = { id: number; pieces: number[]; monkeyMadness: boolean };
export type PuzzleSolveReply = { id: number; steps: PuzzleSolveResult };

/** Runs a solve somewhere and reports its steps; the returned function abandons it. */
export interface PuzzleSolveBackend {
    solve(pieces: readonly number[], monkeyMadness: boolean, done: (steps: PuzzleSolveResult) => void): () => void;
    dispose(): void;
}

/**
 * How long IDA* may look for the shortest path to a puzzle box. Most boards take milliseconds,
 * but the server scrambles with 101 random slides and a few of those take IDA* minutes; past
 * the budget the row-by-row solver (IDAStarMM, which solves any board) gives a longer path at once.
 */
export const OPTIMAL_SEARCH_BUDGET_MS = 3000;

const toSteps = (path: PuzzleState[]): number[][] => path.map((step) => step.getPieces().slice());

/** The solve itself, shared by the worker and the inline backend. */
export function computeSteps(
    pieces: readonly number[],
    monkeyMadness: boolean,
    budgetMs = OPTIMAL_SEARCH_BUDGET_MS,
    now: () => number = () => Date.now(),
): PuzzleSolveResult {
    try {
        const start = new PuzzleState(pieces);
        if (monkeyMadness) return toSteps(createPathfinder(true).computePath(start));
        try {
            return toSteps(new IDAStar(new ManhattanDistance(), { at: now() + budgetMs, now }).computePath(start));
        } catch (error) {
            if (!(error instanceof SearchBudgetExceeded)) throw error;
            return toSteps(createPathfinder(true).computePath(new PuzzleState(pieces)));
        }
    } catch {
        return null;
    }
}

/** Solves on the calling thread, for tests and browsers without Web Workers. */
export class InlineSolveBackend implements PuzzleSolveBackend {
    solve(pieces: readonly number[], monkeyMadness: boolean, done: (steps: PuzzleSolveResult) => void): () => void {
        done(computeSteps(pieces, monkeyMadness));
        return () => {};
    }

    dispose(): void {}
}

/**
 * Solves on a Web Worker, as RuneLite submits the solver to an executor, so a long search never
 * stalls a frame. A new solve, or abandoning one, ends the worker: IDA* has no yield point, so
 * stopping the thread is the only way to drop a stale search (RuneLite's future.cancel).
 */
export class WorkerSolveBackend implements PuzzleSolveBackend {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending: { id: number; done: (steps: PuzzleSolveResult) => void } | null = null;

    private ensureWorker(): Worker {
        if (this.worker) return this.worker;
        // Keep this exact `new Worker(new URL(...))` shape so webpack emits a worker chunk.
        const worker = new Worker(new URL("./PuzzleSolverWorker.ts", import.meta.url));
        worker.onmessage = (event: MessageEvent<PuzzleSolveReply>) => {
            const pending = this.pending;
            if (!pending || pending.id !== event.data.id) return;
            this.pending = null;
            pending.done(event.data.steps);
        };
        worker.onerror = () => {
            const pending = this.pending;
            this.stop();
            pending?.done(null);
        };
        this.worker = worker;
        return worker;
    }

    solve(pieces: readonly number[], monkeyMadness: boolean, done: (steps: PuzzleSolveResult) => void): () => void {
        if (this.pending) this.stop();
        const id = this.nextId++;
        const request: PuzzleSolveRequest = { id, pieces: pieces.slice(), monkeyMadness };
        let worker: Worker;
        try {
            worker = this.ensureWorker();
        } catch {
            // No worker allowed here (a content policy, say): solve on this thread instead.
            done(computeSteps(pieces, monkeyMadness));
            return () => {};
        }
        this.pending = { id, done };
        worker.postMessage(request);
        return () => {
            if (this.pending?.id === id) this.stop();
        };
    }

    private stop(): void {
        this.pending = null;
        this.worker?.terminate();
        this.worker = null;
    }

    dispose(): void {
        this.stop();
    }
}

/** A worker where the browser has them, otherwise inline. */
export function createSolveBackend(): PuzzleSolveBackend {
    return typeof Worker === "undefined" ? new InlineSolveBackend() : new WorkerSolveBackend();
}
