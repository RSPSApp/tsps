# Puzzle Solver

A port of RuneLite's Puzzle Solver plugin (`runelite-client/.../plugins/puzzlesolver`, master
`8f2aca1`). Like every RuneLite port here it is off by default; turn it on under Plugins.

- **Puzzle boxes** (Treasure Trails, and Monkey Madness I's puzzle): while the sliding puzzle is open,
  the next moves are drawn on the slots to click, as dots that shrink and fade from the start colour
  to the end colour (**Number of dots**, 4-8) or as arrows (**Draw dots instead of arrows** off). A box
  above the puzzle says "Moves left: N", "Solved!", "Solving.." or "The puzzle could not be solved"
  (**Display remaining moves**). Go off the path and it solves again from where you are.
- **Light boxes** (master clues): press each switch once; the title becomes "Light box - Solution:"
  and the fewest switches that light every bulb, once the switches seen so far can do it.
- **Varrock Museum**: the right answer to each Natural History quiz question is coloured green.

## Where it differs from RuneLite

- The solve runs on a Web Worker (RuneLite uses an executor thread), so it never stalls a frame.
- RuneLite searches for the shortest path with no time limit. tsps scrambles boxes with 101 random
  slides (the Wiki's figure), and a few such boards take that search minutes, so after 3 seconds it
  uses the row-by-row solver RuneLite has for Monkey Madness I instead: a longer path, but at once.
- RuneLite colours the museum answer when the quiz interface loads. Here the interface mounts before
  the server's question and answer text arrives, so the answer is checked on each game tick while the
  quiz is open (an answer already coloured is left alone).
- The server does not run Monkey Madness I's puzzle yet (inventory `reinitialisation_inv`); that path
  is ported and covered by RuneLite's MM boards in `client/tests/puzzle-solver.test.ts`.

Tests: `client/tests/puzzle-solver.test.ts` (RuneLite's PuzzleSolverTest boards and the budget
fallback) and `client/tests/puzzle-solver-plugin.test.ts` (RuneLite's LightboxSolverTest, then the
light box, museum quiz and puzzle overlay on the real cache interfaces).
