/*
 * Copyright (c) 2018, Adam <Adam@sigterm.info>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ../LICENSE.
 */
import * as ItemID from "@runelite/api/gameval/ItemID";

/** RuneLite's LightBox constants. */
export const LightBox = {
    WIDTH: 5,
    HEIGHT: 5,
    COMBINATIONS_POWER: 8,
    /** The lit bulb the light box draws (obj 20357). */
    LIGHT_BULB_ON: ItemID.TRAIL_LIGHT_LIT,
} as const;

/** The light box's switches, in button order (RuneLite's Combination). */
export const COMBINATIONS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type Combination = (typeof COMBINATIONS)[number];

/** Which lights are on (RuneLite's LightboxState). */
export class LightboxState {
    private readonly state: boolean[][] = Array.from({ length: LightBox.WIDTH }, () => new Array<boolean>(LightBox.HEIGHT).fill(false));

    setState(x: number, y: number, s: boolean): void {
        this.state[x][y] = s;
    }

    getState(x: number, y: number): boolean {
        return this.state[x][y];
    }

    /** The lights that differ from `other`. */
    diff(other: LightboxState): LightboxState {
        const newState = new LightboxState();
        for (let i = 0; i < LightBox.WIDTH; ++i) {
            for (let j = 0; j < LightBox.HEIGHT; ++j) newState.state[i][j] = this.state[i][j] !== other.state[i][j];
        }
        return newState;
    }

    equals(other: LightboxState | null | undefined): boolean {
        if (!other) return false;
        for (let i = 0; i < LightBox.WIDTH; ++i) {
            for (let j = 0; j < LightBox.HEIGHT; ++j) if (this.state[i][j] !== other.state[i][j]) return false;
        }
        return true;
    }
}

/** The switches to press, one bit per switch (RuneLite's LightboxSolution). */
export class LightboxSolution {
    constructor(private solution = 0) {}

    flip(c: Combination): void {
        this.solution ^= 1 << COMBINATIONS.indexOf(c);
    }

    numMoves(): number {
        let count = 0;
        for (let i = 0, cur = this.solution; i < COMBINATIONS.length; ++i, cur >>= 1) count += cur & 1;
        return count;
    }

    equals(other: LightboxSolution | null | undefined): boolean {
        return !!other && other.solution === this.solution;
    }

    /** The switches' letters in order, e.g. "ABDEFG". */
    toString(): string {
        return COMBINATIONS.filter((_, index) => ((this.solution >>> index) & 1) !== 0).join("");
    }
}

const isBitSet = (num: number, bit: number): boolean => ((num >>> bit) & 1) !== 0;

function isSolved(s: LightboxState): boolean {
    for (let i = 0; i < LightBox.WIDTH; ++i) {
        for (let j = 0; j < LightBox.HEIGHT; ++j) if (!s.getState(i, j)) return false;
    }
    return true;
}

/**
 * Tries every set of known switches and keeps the one with fewest presses that lights every
 * bulb (RuneLite's LightboxSolver). Each press toggles a fixed set of lights, so order is moot.
 */
export class LightboxSolver {
    private initial: LightboxState | null = null;
    private readonly switches: (LightboxState | null)[] = new Array(LightBox.COMBINATIONS_POWER).fill(null);

    solve(): LightboxSolution | null {
        if (!this.initial) return null;
        let solution: LightboxSolution | null = null;
        outer:
        for (let i = 0; i < 1 << LightBox.COMBINATIONS_POWER; ++i) {
            let s = this.initial;
            for (let bit = 0; bit < LightBox.COMBINATIONS_POWER; ++bit) {
                if (!isBitSet(i, bit)) continue;
                // This switch is unknown, so this can't be a valid answer
                const change = this.switches[bit];
                if (change === null) continue outer;
                s = s.diff(change);
            }
            if (isSolved(s)) {
                const sol = new LightboxSolution(i);
                if (solution === null || sol.numMoves() < solution.numMoves()) solution = sol;
            }
        }
        return solution;
    }

    setInitial(initial: LightboxState): void {
        this.initial = initial;
    }

    setSwitchChange(combination: Combination, newState: LightboxState): void {
        this.switches[COMBINATIONS.indexOf(combination)] = newState;
    }
}
