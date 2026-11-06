/*
 * Copyright (c) 2018, Steffen Hauge <steffen.oerum.hauge@hotmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */
import { IDAStar } from "./IDAStar";
import { BLANK_TILE_VALUE, DIMENSION, type PuzzleState } from "./PuzzleState";
import {
    LAST_PIECE_COLUMN, LAST_PIECE_ROW, type PuzzleSwapPattern,
    ROTATE_DOWN_LEFT, ROTATE_DOWN_RIGHT, ROTATE_LEFT_DOWN, ROTATE_LEFT_UP, ROTATE_RIGHT_DOWN, ROTATE_RIGHT_UP,
    ROTATE_UP_LEFT, ROTATE_UP_RIGHT, SHUFFLE_UP_ABOVE, SHUFFLE_UP_BELOW, SHUFFLE_UP_LEFT, SHUFFLE_UP_RIGHT,
} from "./PuzzleSwapPattern";

type Point = { readonly x: number; readonly y: number };

const point = (x: number, y: number): Point => ({ x, y });

/**
 * The Monkey Madness I solver (RuneLite's IDAStarMM): place the top row, the left column and the
 * second row by fixed swap patterns, then hand the remaining 3x4 board to IDA*.
 */
export class IDAStarMM extends IDAStar {
    private currentState!: PuzzleState;
    private readonly stateList: PuzzleState[] = [];
    private readonly validRowNumbers: number[][] = [[0, 1, 2, 3, 4], [6, 7, 8, 9]];
    private readonly validColumnNumbers: number[][] = [[5, 10, 15, 20]];

    computePath(root: PuzzleState): PuzzleState[] {
        this.currentState = root;
        this.stateList.push(root);

        this.solveRow(0); // Reduce to 4x5
        this.solveColumn(); // Reduce to 4x4
        this.solveRow(1); // Reduce to 3x4

        // Remove the last state: IDA* starts from it.
        this.stateList.pop();
        return [...this.stateList, ...super.computePath(this.currentState)];
    }

    private solveRow(row: number): void {
        for (let i = row; i < DIMENSION; i++) {
            const valTarget = row * DIMENSION + i;
            if (this.currentState.getPiece(i, row) !== valTarget) this.moveTowardsVal(valTarget, i, row, true);
        }
    }

    private solveColumn(): void {
        const column = 0;
        for (let i = column + 1; i < DIMENSION; i++) {
            const valTarget = column + i * DIMENSION;
            if (this.currentState.getPiece(column, i) !== valTarget) this.moveTowardsVal(valTarget, column, i, false);
        }
    }

    private moveTowardsVal(valTarget: number, x: number, y: number, rowMode: boolean): void {
        // Not in place
        let reached = false;
        while (this.currentState.getPiece(x, y) !== valTarget) {
            const locVal = this.findPiece(valTarget);
            const locBlank = this.findPiece(BLANK_TILE_VALUE);

            if (reached) {
                // Swap towards locTarget
                if (rowMode) {
                    this.alignTargetX(valTarget, x, y);
                    this.swapUpRow(valTarget, x, y);
                } else {
                    this.alignTargetY(valTarget, x, y);
                    this.swapLeftColumn(valTarget, x, y);
                }
                continue;
            }

            const distX = locVal.x - locBlank.x;
            const distY = locVal.y - locBlank.y;
            const distAbsX = Math.abs(distX);
            const distAbsY = Math.abs(distY);

            if (distX === 0) {
                // Same column
                if (distAbsY === 1) {
                    reached = true; // Next to
                } else if (distY >= 2) {
                    // More than 2 away, move towards on Y-axis
                    this.swap(locBlank, point(locBlank.x, locBlank.y + 1));
                } else if (distY <= -2) {
                    this.swap(locBlank, point(locBlank.x, locBlank.y - 1));
                }
            } else if (distY === 0) {
                // Same row
                if (distAbsX === 1) {
                    reached = true; // Next to
                } else if (distX >= 2) {
                    // More than 2 away, move towards on X-axis
                    this.swap(locBlank, point(locBlank.x + 1, locBlank.y));
                } else if (distX <= -2) {
                    this.swap(locBlank, point(locBlank.x - 1, locBlank.y));
                }
            } else if (rowMode) {
                // Different row and column. Check if already correct above
                const above = this.currentState.getPiece(locBlank.x, locBlank.y - 1);
                if (locBlank.y - 1 === y && this.validRowNumbers[y].includes(above) && above < valTarget && distY <= -1) {
                    // Move forward
                    this.swap(locBlank, point(locBlank.x + 1, locBlank.y));
                    continue;
                }
                // Move downwards or upwards
                if (distY >= 1) this.swap(locBlank, point(locBlank.x, locBlank.y + 1));
                else if (distY <= -1) this.swap(locBlank, point(locBlank.x, locBlank.y - 1));
            } else {
                // Check if already correct to the left
                const left = this.currentState.getPiece(locBlank.x - 1, locBlank.y);
                if (locBlank.x - 1 === x && this.validColumnNumbers[x].includes(left) && left < valTarget && distX <= -1) {
                    // Move down
                    this.swap(locBlank, point(locBlank.x, locBlank.y + 1));
                    continue;
                }
                // Move right or left
                if (distX >= 1) this.swap(locBlank, point(locBlank.x + 1, locBlank.y));
                else if (distX <= -1) this.swap(locBlank, point(locBlank.x - 1, locBlank.y));
            }
        }
    }

    private alignTargetX(valTarget: number, x: number, y: number): void {
        let locVal = this.findPiece(valTarget);
        // Check if same column
        if (locVal.x === x) return;
        // 1 = right, -1 = left
        const direction = Math.sign(x - locVal.x);
        while (locVal.x !== x) {
            locVal = this.findPiece(valTarget);
            const locBlank = this.findPiece(BLANK_TILE_VALUE);
            // Check if aligned
            if (x - locVal.x === 0) break;

            if (locVal.x === locBlank.x) {
                const diff = locBlank.y - locVal.y;
                if (diff === 1) {
                    // Below
                    const loc1 = point(locBlank.x + direction, locBlank.y);
                    const loc2 = point(loc1.x, loc1.y - 1);
                    this.swap(locBlank, loc1);
                    this.swap(loc1, loc2);
                    this.swap(loc2, locVal);
                } else if (diff === -1) {
                    // Above
                    this.swap(locBlank, locVal);
                }
            } else if (locVal.y === locBlank.y) {
                const diff = locBlank.x - locVal.x;
                if (diff === 1) {
                    // Right
                    if (direction === 1) this.swap(locVal, locBlank);
                    else if (direction === -1) {
                        // No space below: rotate over the top; otherwise underneath.
                        this.performSwapPattern(locBlank, locVal, locVal.y === DIMENSION - 1 ? ROTATE_LEFT_UP : ROTATE_LEFT_DOWN);
                    }
                } else if (diff === -1) {
                    // Left
                    if (direction === -1) this.swap(locVal, locBlank);
                    else if (direction === 1) {
                        this.performSwapPattern(locBlank, locVal, locVal.y === DIMENSION - 1 ? ROTATE_RIGHT_UP : ROTATE_RIGHT_DOWN);
                    }
                }
            }
        }
    }

    /** Swaps up until inserted into the correct place. */
    private swapUpRow(valTarget: number, x: number, y: number): void {
        let locVal = this.findPiece(valTarget);
        let locBlank = this.findPiece(BLANK_TILE_VALUE);
        // Check if already placed correct
        if (locVal.x === x && locVal.y === y) return;
        // Check if simple swap is enough
        if (locBlank.x === x && locBlank.y === y && locVal.y - 1 === y) {
            this.swap(locBlank, locVal);
            return;
        }
        // Move up
        for (;;) {
            locVal = this.findPiece(valTarget);
            locBlank = this.findPiece(BLANK_TILE_VALUE);
            if (locVal.x === x && locVal.y === y) return;

            if (locVal.x === locBlank.x) {
                const diff = locBlank.y - locVal.y;
                if (diff === 1) {
                    // Below. Last piece
                    if (x === DIMENSION - 1) {
                        this.performSwapPattern(locBlank, locVal, LAST_PIECE_ROW);
                        return;
                    }
                    this.performSwapPattern(locBlank, locVal, ROTATE_UP_RIGHT);
                } else if (diff === -1) {
                    // Above
                    this.swap(locBlank, locVal);
                }
            } else if (locVal.y === locBlank.y) {
                const diff = locBlank.x - locVal.x;
                if (diff === 1) {
                    // Right
                    this.performSwapPattern(locBlank, locVal, SHUFFLE_UP_RIGHT);
                } else if (diff === -1) {
                    // Left. Don't remove correct pieces from row
                    if (locVal.y - 1 === y) {
                        // Swap blank to below and continue
                        const loc1 = point(locBlank.x, locBlank.y + 1);
                        const loc2 = point(loc1.x + 1, loc1.y);
                        this.swap(locBlank, loc1);
                        this.swap(loc1, loc2);
                        continue;
                    }
                    this.performSwapPattern(locBlank, locVal, SHUFFLE_UP_LEFT);
                }
            }
        }
    }

    private alignTargetY(valTarget: number, x: number, y: number): void {
        let locVal = this.findPiece(valTarget);
        // Check if same row
        if (locVal.y === y) return;
        // 1 = down, -1 = up
        const direction = Math.sign(y - locVal.y);
        while (locVal.y !== y) {
            locVal = this.findPiece(valTarget);
            const locBlank = this.findPiece(BLANK_TILE_VALUE);
            // Check if aligned
            if (y - locVal.y === 0) break;

            if (locVal.y === locBlank.y) {
                const diff = locBlank.x - locVal.x;
                if (diff === 1) {
                    // Right
                    const loc1 = point(locBlank.x, locBlank.y + direction);
                    const loc2 = point(loc1.x - 1, loc1.y);
                    this.swap(locBlank, loc1);
                    this.swap(loc1, loc2);
                    this.swap(loc2, locVal);
                } else if (diff === -1) {
                    // Left
                    this.swap(locBlank, locVal);
                }
            } else if (locVal.x === locBlank.x) {
                const diff = locBlank.y - locVal.y;
                if (diff === 1) {
                    // Below
                    if (direction === 1) this.swap(locVal, locBlank);
                    else if (direction === -1) {
                        // No space to the right: rotate left; otherwise right.
                        this.performSwapPattern(locBlank, locVal, locVal.x === DIMENSION - 1 ? ROTATE_UP_LEFT : ROTATE_UP_RIGHT);
                    }
                } else if (diff === -1) {
                    // Above
                    if (direction === -1) this.swap(locVal, locBlank);
                    else if (direction === 1) {
                        this.performSwapPattern(locBlank, locVal, locVal.x === DIMENSION - 1 ? ROTATE_DOWN_LEFT : ROTATE_DOWN_RIGHT);
                    }
                }
            }
        }
    }

    /** Swaps left until inserted into the correct place. */
    private swapLeftColumn(valTarget: number, x: number, y: number): void {
        let locVal = this.findPiece(valTarget);
        let locBlank = this.findPiece(BLANK_TILE_VALUE);
        // Check if already placed correct
        if (locVal.x === x && locVal.y === y) return;
        // Check if simple swap is enough
        if (locBlank.x === x && locBlank.y === y && locVal.x - 1 === x) {
            this.swap(locBlank, locVal);
            return;
        }
        // Move left
        for (;;) {
            locVal = this.findPiece(valTarget);
            locBlank = this.findPiece(BLANK_TILE_VALUE);
            if (locVal.x === x && locVal.y === y) return;

            if (locVal.x === locBlank.x) {
                const diff = locBlank.y - locVal.y;
                if (diff === 1) {
                    // Below
                    this.performSwapPattern(locBlank, locVal, SHUFFLE_UP_BELOW);
                } else if (diff === -1) {
                    // Above. Don't remove correct pieces from the column
                    if (locVal.x - 1 === x) {
                        // Swap blank to right and continue
                        const loc1 = point(locBlank.x + 1, locBlank.y);
                        const loc2 = point(loc1.x, loc1.y + 1);
                        this.swap(locBlank, loc1);
                        this.swap(loc1, loc2);
                        continue;
                    }
                    this.performSwapPattern(locBlank, locVal, SHUFFLE_UP_ABOVE);
                }
            } else if (locVal.y === locBlank.y) {
                const diff = locBlank.x - locVal.x;
                if (diff === 1) {
                    // Right. Last piece
                    if (y === DIMENSION - 1) {
                        this.performSwapPattern(locBlank, locVal, LAST_PIECE_COLUMN);
                        return;
                    }
                    this.performSwapPattern(locBlank, locVal, ROTATE_LEFT_DOWN);
                } else if (diff === -1) {
                    // Left
                    this.swap(locBlank, locVal);
                }
            }
        }
    }

    private swap(p1: Point, p2: Point): void {
        this.currentState = this.currentState.swap(p1.x, p1.y, p2.x, p2.y);
        this.stateList.push(this.currentState);
    }

    private findPiece(val: number): Point {
        for (let x = 0; x < DIMENSION; x++) {
            for (let y = 0; y < DIMENSION; y++) {
                if (this.currentState.getPiece(x, y) === val) return point(x, y);
            }
        }
        // This should never happen
        throw new Error("Piece wasn't found!");
    }

    /**
     * Assumes locBlank is the first point of the swaps and locVal the last:
     * swap(locBlank, loc1); swap(loc1, loc2); swap(loc2, locVal).
     */
    private performSwapPattern(locBlank: Point, locVal: Point, pattern: PuzzleSwapPattern): void {
        let offsets: readonly number[] | null;
        switch (pattern) {
            case ROTATE_LEFT_UP:
            case ROTATE_RIGHT_UP:
            case ROTATE_RIGHT_DOWN:
            case ROTATE_LEFT_DOWN:
                offsets = ROTATE_LEFT_UP.points;
                break;
            case ROTATE_UP_LEFT:
            case ROTATE_UP_RIGHT:
            case ROTATE_DOWN_LEFT:
            case ROTATE_DOWN_RIGHT:
                offsets = ROTATE_UP_LEFT.points;
                break;
            default:
                offsets = pattern.points;
        }
        // This should never happen
        if (offsets === null || offsets.length % 2 === 1) throw new Error("Unexpected points given in pattern!");

        const points: Point[] = [];
        for (let i = 0; i < offsets.length; i += 2) {
            points.push(point(locVal.x + pattern.modX * offsets[i], locVal.y + pattern.modY * offsets[i + 1]));
        }
        // Add locVal as last point
        points.push(locVal);

        if (pattern !== LAST_PIECE_ROW && pattern !== LAST_PIECE_COLUMN) {
            let start = locBlank;
            for (const p of points) {
                this.swap(start, p);
                start = p;
            }
            return;
        }

        const [loc1, loc2, loc3, loc4] = points;
        this.swap(locBlank, locVal);
        this.swap(locVal, loc3);
        this.swap(loc3, loc1);
        this.swap(loc1, loc2);
        this.swap(loc2, locVal);
        this.swap(locVal, loc3);
        this.swap(loc3, loc1);
        this.swap(loc1, loc2);
        this.swap(loc2, locVal);
        this.swap(locVal, locBlank);
        this.swap(locBlank, loc4);
        this.swap(loc4, loc3);
        this.swap(loc3, loc1);
        this.swap(loc1, loc2);
        this.swap(loc2, locVal);
    }
}
