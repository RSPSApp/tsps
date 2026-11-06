/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * Copyright (c) 2018, Henke <https://github.com/henke96>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */
import { BLANK_TILE_VALUE, DIMENSION, type Heuristic, type PuzzleState } from "./PuzzleState";

/** The sum of each piece's distance from its goal slot (RuneLite's ManhattanDistance). */
export class ManhattanDistance implements Heuristic {
    computeValue(state: PuzzleState): number {
        const parent = state.getParent();
        if (parent === null) {
            let value = 0;
            for (let x = 0; x < DIMENSION; x++) {
                for (let y = 0; y < DIMENSION; y++) {
                    const piece = state.getPiece(x, y);
                    if (piece === BLANK_TILE_VALUE) continue;
                    value += Math.abs(x - (piece % DIMENSION)) + Math.abs(y - Math.floor(piece / DIMENSION));
                }
            }
            return value;
        }

        // One slide moved one piece one step: adjust the parent's value instead of recounting.
        let value = parent.getHeuristicValue(this);
        const x = parent.getEmptyPiece() % DIMENSION;
        const y = Math.floor(parent.getEmptyPiece() / DIMENSION);
        const x2 = state.getEmptyPiece() % DIMENSION;
        const y2 = Math.floor(state.getEmptyPiece() / DIMENSION);
        const piece = state.getPiece(x, y);
        if (x2 > x) {
            value += piece % DIMENSION > x ? 1 : -1; // right
        } else if (x2 < x) {
            value += piece % DIMENSION < x ? 1 : -1; // left
        } else if (y2 > y) {
            value += Math.floor(piece / DIMENSION) > y ? 1 : -1; // down
        } else {
            value += Math.floor(piece / DIMENSION) < y ? 1 : -1; // up
        }
        return value;
    }
}
