/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */

/** The board is DIMENSION x DIMENSION, row-major (RuneLite's PuzzleSolver.DIMENSION). */
export const DIMENSION = 5;
/** The empty slot's value (RuneLite's PuzzleSolver.BLANK_TILE_VALUE). */
export const BLANK_TILE_VALUE = -1;

/** What scores a state for the solver (RuneLite's Heuristic). */
export interface Heuristic {
    computeValue(state: PuzzleState): number;
}

/** One board on the way to the goal, linked to the board it came from (RuneLite's PuzzleState). */
export class PuzzleState {
    private parent: PuzzleState | null = null;
    private pieces: number[];
    private emptyPiece = -1;
    private h = -1;

    constructor(pieces: readonly number[]) {
        if (pieces == null) throw new Error("Pieces cannot be null");
        if (DIMENSION * DIMENSION !== pieces.length) throw new Error("Piece array does not have the right dimensions");
        this.pieces = pieces.slice();
        this.findEmptyPiece();
    }

    /** RuneLite's copy constructor: the pieces and blank, no parent and no cached heuristic. */
    private copy(): PuzzleState {
        const state: PuzzleState = Object.create(PuzzleState.prototype);
        state.parent = null;
        state.pieces = this.pieces.slice();
        state.emptyPiece = this.emptyPiece;
        state.h = -1;
        return state;
    }

    private findEmptyPiece(): void {
        const index = this.pieces.indexOf(BLANK_TILE_VALUE);
        if (index < 0) throw new Error("Incorrect empty piece passed in!");
        this.emptyPiece = index;
    }

    /** The boards one slide away, never undoing the slide that made this one. */
    computeMoves(): PuzzleState[] {
        const moves: PuzzleState[] = [];
        const emptyPieceX = this.emptyPiece % DIMENSION;
        const emptyPieceY = Math.floor(this.emptyPiece / DIMENSION);
        // Left, right, up, down: the order RuneLite tries them in.
        if (emptyPieceX > 0) this.addMove(moves, -1);
        if (emptyPieceX < DIMENSION - 1) this.addMove(moves, 1);
        if (emptyPieceY > 0) this.addMove(moves, -DIMENSION);
        if (emptyPieceY < DIMENSION - 1) this.addMove(moves, DIMENSION);
        return moves;
    }

    private addMove(moves: PuzzleState[], offset: number): void {
        const target = this.emptyPiece + offset;
        if (this.parent !== null && this.parent.emptyPiece === target) return;
        const state = this.copy();
        state.parent = this;
        state.pieces[target] = BLANK_TILE_VALUE;
        state.pieces[this.emptyPiece] = this.pieces[target];
        state.emptyPiece = target;
        moves.push(state);
    }

    getParent(): PuzzleState | null {
        return this.parent;
    }

    hasPieces(pieces: readonly number[]): boolean {
        if (pieces.length !== this.pieces.length) return false;
        for (let i = 0; i < pieces.length; i++) if (pieces[i] !== this.pieces[i]) return false;
        return true;
    }

    getPieces(): readonly number[] {
        return this.pieces;
    }

    getPiece(x: number, y: number): number {
        return this.pieces[y * DIMENSION + x];
    }

    getEmptyPiece(): number {
        return this.emptyPiece;
    }

    getHeuristicValue(heuristic: Heuristic): number {
        if (this.h === -1) this.h = heuristic.computeValue(this);
        return this.h;
    }

    swap(x1: number, y1: number, x2: number, y2: number): PuzzleState {
        const val1 = this.getPiece(x1, y1);
        const val2 = this.getPiece(x2, y2);
        if (!this.isValidSwap(x1, y1, x2, y2)) throw new Error(`Invalid swap: (${x1}, ${y1}), (${x2}, ${y2})`);
        const newState = this.copy();
        newState.pieces[y1 * DIMENSION + x1] = val2;
        newState.pieces[y2 * DIMENSION + x2] = val1;
        newState.findEmptyPiece();
        return newState;
    }

    private isValidSwap(x1: number, y1: number, x2: number, y2: number): boolean {
        const absX = Math.abs(x1 - x2);
        const absY = Math.abs(y1 - y2);
        if (this.getPiece(x1, y1) !== BLANK_TILE_VALUE && this.getPiece(x2, y2) !== BLANK_TILE_VALUE) return false;
        if (x1 === x2 && absY === 1) return true;
        return y1 === y2 && absX === 1;
    }
}
