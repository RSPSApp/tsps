import * as InterfaceID from "@runelite/api/gameval/InterfaceID";

/**
 * The interface components the plugin reads. The generated InterfaceID carries group ids only, so
 * each child index is RuneLite's gameval InterfaceID, named beside it.
 */
const component = (group: number, child: number): number => (group << 16) | child;

/** trail_slidepuzzle:pieces — the 5x5 grid of puzzle pieces. */
export const TRAIL_SLIDEPUZZLE_PIECES = component(InterfaceID.TRAIL_SLIDEPUZZLE, 4);

/** light_puzzle:steel_border — the frame; its second dynamic child is the title. */
export const LIGHT_PUZZLE_STEEL_BORDER = component(InterfaceID.LIGHT_PUZZLE, 1);
/** light_puzzle:lights — the 25 bulbs, one dynamic child each. */
export const LIGHT_PUZZLE_LIGHTS = component(InterfaceID.LIGHT_PUZZLE, 3);
/** light_puzzle:button1 to button8 — switches A to H. */
export const LIGHT_PUZZLE_BUTTONS = [8, 9, 10, 11, 12, 13, 14, 15].map((child) => component(InterfaceID.LIGHT_PUZZLE, child));

/** vm_natural_history:vm_nathis_question and vm_nathis_answer_01 to 03. */
export const VM_NATHIS_QUESTION = component(InterfaceID.VM_NATURAL_HISTORY, 28);
export const VM_NATHIS_ANSWERS = [29, 30, 31].map((child) => component(InterfaceID.VM_NATURAL_HISTORY, child));
