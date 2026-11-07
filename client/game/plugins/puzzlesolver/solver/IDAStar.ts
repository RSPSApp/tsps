/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */
import type { Heuristic, PuzzleState } from "./PuzzleState";

/** Finds the boards from a start to the goal (RuneLite's Pathfinder). */
export abstract class Pathfinder {
    protected constructor(private readonly heuristic: Heuristic) {}

    getHeuristic(): Heuristic {
        return this.heuristic;
    }

    abstract computePath(start: PuzzleState): PuzzleState[];
}

/** Thrown out of the search when its time budget runs out. */
export class SearchBudgetExceeded extends Error {
    constructor() {
        super("IDA* search budget exceeded");
    }
}

/** How many nodes the search visits between clock checks. */
const BUDGET_CHECK_INTERVAL = 4096;

/** Iterative deepening A* (https://en.wikipedia.org/wiki/Iterative_deepening_A*), RuneLite's IDAStar. */
export class IDAStar extends Pathfinder {
    private visited = 0;

    /**
     * `deadline` (a `now()` time) stops the search with SearchBudgetExceeded; RuneLite has no
     * budget, so without one it searches until it finds the shortest path.
     */
    constructor(heuristic: Heuristic, private readonly deadline?: { at: number; now: () => number }) {
        super(heuristic);
    }

    computePath(root: PuzzleState): PuzzleState[] {
        const path: PuzzleState[] = [];
        for (let parent: PuzzleState | null = this.path(root); parent !== null; parent = parent.getParent()) path.push(parent);
        return path.reverse();
    }

    private path(root: PuzzleState): PuzzleState {
        let bound = root.getHeuristicValue(this.getHeuristic());
        for (;;) {
            const t = this.search(root, 0, bound);
            if (t !== null) return t;
            bound += 1;
        }
    }

    private search(node: PuzzleState, g: number, bound: number): PuzzleState | null {
        if (this.deadline && ++this.visited % BUDGET_CHECK_INTERVAL === 0 && this.deadline.now() > this.deadline.at) {
            throw new SearchBudgetExceeded();
        }
        const h = node.getHeuristicValue(this.getHeuristic());
        if (g + h > bound) return null;
        if (h === 0) return node;
        for (const successor of node.computeMoves()) {
            const t = this.search(successor, g + 1, bound);
            if (t !== null) return t;
        }
        return null;
    }
}
