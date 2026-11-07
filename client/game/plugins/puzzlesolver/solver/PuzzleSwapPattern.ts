/*
 * Copyright (c) 2018, Steffen Hauge <steffen.oerum.hauge@hotmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */

/**
 * A fixed run of swaps around a piece (RuneLite's PuzzleSwapPattern). `points` are offsets
 * relative to the piece; a pattern without its own points reuses its family's reference points,
 * mirrored by `modX`/`modY`.
 */
export type PuzzleSwapPattern = {
    readonly name: string;
    readonly points: readonly number[] | null;
    readonly modX: number;
    readonly modY: number;
};

function pattern(name: string, points: readonly number[] | null, modX: number, modY: number): PuzzleSwapPattern {
    return Object.freeze({ name, points, modX, modY });
}

export const ROTATE_LEFT_UP = pattern("ROTATE_LEFT_UP", [1, -1, 0, -1, -1, -1, -1, 0], 1, 1); // Reference point
export const ROTATE_LEFT_DOWN = pattern("ROTATE_LEFT_DOWN", null, 1, -1);
export const ROTATE_RIGHT_UP = pattern("ROTATE_RIGHT_UP", null, -1, 1);
export const ROTATE_RIGHT_DOWN = pattern("ROTATE_RIGHT_DOWN", null, -1, -1);
export const ROTATE_UP_LEFT = pattern("ROTATE_UP_LEFT", [-1, 1, -1, 0, -1, -1, 0, -1], 1, 1); // Reference point
export const ROTATE_UP_RIGHT = pattern("ROTATE_UP_RIGHT", null, -1, 1);
export const ROTATE_DOWN_LEFT = pattern("ROTATE_DOWN_LEFT", null, 1, -1);
export const ROTATE_DOWN_RIGHT = pattern("ROTATE_DOWN_RIGHT", null, -1, -1);
export const LAST_PIECE_ROW = pattern("LAST_PIECE_ROW", [-1, -1, 0, -1, -1, 0, -1, 1], 1, 1);
export const LAST_PIECE_COLUMN = pattern("LAST_PIECE_COLUMN", [-1, -1, -1, 0, 0, -1, 1, -1], 1, 1);
export const SHUFFLE_UP_RIGHT = pattern("SHUFFLE_UP_RIGHT", [1, -1, 0, -1], 1, 1);
export const SHUFFLE_UP_LEFT = pattern("SHUFFLE_UP_LEFT", [-1, -1, 0, -1], 1, 1);
export const SHUFFLE_UP_BELOW = pattern("SHUFFLE_UP_BELOW", [-1, 1, -1, 0], 1, 1);
export const SHUFFLE_UP_ABOVE = pattern("SHUFFLE_UP_ABOVE", [-1, -1, -1, 0], 1, 1);
