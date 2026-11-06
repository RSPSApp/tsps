/* eslint-disable no-restricted-globals */
// The puzzle solver's thread: one solve per message, its steps posted back.
import { computeSteps, type PuzzleSolveReply, type PuzzleSolveRequest } from "./PuzzleSolveBackend";

const scope = self as unknown as {
    postMessage(message: PuzzleSolveReply): void;
    onmessage: ((event: MessageEvent<PuzzleSolveRequest>) => void) | null;
};

scope.onmessage = (event) => {
    const { id, pieces, monkeyMadness } = event.data;
    scope.postMessage({ id, steps: computeSteps(pieces, monkeyMadness) });
};
