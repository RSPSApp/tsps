import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameState } from "../runelite/api/GameState";
import * as InventoryID from "../runelite/api/gameval/InventoryID";
import * as ItemID from "../runelite/api/gameval/ItemID";
import { TRAIL_LIGHTS } from "../runelite/api/gameval/VarPlayerID";
import { RecordingGraphics2D } from "../runelite/awt/Graphics2D";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, PluginInjector } from "../runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../runelite/impl/ClientImpl";
import { COMBINATIONS, LightboxSolution, LightboxSolver, LightboxState } from "../game/plugins/puzzlesolver/lightbox/Lightbox";
import { getItemIds, PuzzleSolverOverlay, type PuzzleSolverOverlayHost } from "../game/plugins/puzzlesolver/PuzzleSolverOverlay";
import { LIGHT_PUZZLE_BUTTONS, LIGHT_PUZZLE_LIGHTS, LIGHT_PUZZLE_STEEL_BORDER, TRAIL_SLIDEPUZZLE_PIECES, VM_NATHIS_ANSWERS, VM_NATHIS_QUESTION } from "../game/plugins/puzzlesolver/PuzzleSolverInterfaces";
import { PuzzleSolverPlugin } from "../game/plugins/puzzlesolver/PuzzleSolverPlugin";
import { InlineSolveBackend } from "../game/plugins/puzzlesolver/solver/PuzzleSolveBackend";
import { correctMuseumAnswer } from "../game/plugins/puzzlesolver/VarrockMuseumAnswer";
import { Item } from "../runelite/api/Item";
import { Inventory } from "../rs/inventory/Inventory";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { Color } from "../runelite/awt/Color";
import type { MenuActionData } from "../ui/menu/menuEvents";

// ---------------------------------------------------------------- RuneLite LightboxSolverTest

const grid = (rows: string) => {
    const s = new LightboxState();
    const bits = rows.replace(/\s/g, "");
    assert.equal(bits.length, 25);
    for (let i = 0; i < 25; ++i) s.setState(Math.floor(i / 5), i % 5, bits[i] === "1");
    return s;
};
{
    const solver = new LightboxSolver();
    solver.setInitial(grid("10100 01010 01110 01010 10101"));
    solver.setSwitchChange("A", grid("01000 00001 01010 00010 00001"));
    solver.setSwitchChange("B", grid("01000 10001 00010 11010 00011"));
    solver.setSwitchChange("C", grid("01000 10001 11000 01000 00001"));
    solver.setSwitchChange("D", grid("11000 10101 11011 01100 10011"));
    solver.setSwitchChange("E", grid("10010 11101 11010 00100 10011"));
    solver.setSwitchChange("F", grid("10010 10001 10110 00100 10000"));
    solver.setSwitchChange("G", grid("10011 11100 01110 00001 11000"));
    solver.setSwitchChange("H", grid("10111 11100 01110 11001 10010"));
    const expected = new LightboxSolution();
    for (const c of ["A", "B", "D", "E", "F", "G"] as const) expected.flip(c);
    const solution = solver.solve();
    assert.ok(expected.equals(solution), `RuneLite's light box solves to ABDEFG, got ${solution}`);
    assert.equal(String(solution), "ABDEFG");
}

// ---------------------------------------------------------------- the plugin on the real cache

// Everything below runs on the real installed cache (server/caches); without one, as on CI, it is
// skipped and said so, as in runelite-client-facade.test.ts.
if (!existsSync(resolve(__dirname, "../../server/caches/caches.json")) || process.env.RL_TEST_NO_CACHE) {
    console.log("puzzle-solver-plugin: no server/caches, cache-backed sections skipped");
    process.exit(0);
}

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
const vars = vm.context.varManager;
manager.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent(createScriptEvent({ args: widget.onLoad, widget }), 200_000);
manager.onLoadInvoker = (widget: any) => vm.invokeEventHandler(widget, "onLoad");
const osrsClient: any = { widgetManager: manager, varManager: vars, cs2Vm: vm, gameState: 30, serverSentInventoryIds: new Set<number>() };
const configManager = new ConfigManager(undefined);
const plugin = new PluginInjector(configManager)
    .provide(CLIENT_TOKEN, osrsClient)
    .runWith(() => new PuzzleSolverPlugin({ client: osrsClient, configManager, solveBackend: new InlineSolveBackend() }));
assert.equal(PuzzleSolverPlugin.descriptor.enabledByDefault, false, "fresh installs start disabled, as the issue asks");
void plugin.start();

// ---- Light box: cs2 draws light_puzzle from varp trail_lights (a set bit is an unlit bulb).
// The server's switch masks; each press toggles its mask, as Light.TreasureTrails.js does.
const MASKS = [0x0000123, 0x0450880, 0x1004410, 0x0a00009, 0x0120c00, 0x1800042, 0x0042100, 0x0308004];
let unlit = MASKS[0] ^ MASKS[3] ^ MASKS[5];
const setLights = (value: number) => {
    vars.setVarp(TRAIL_LIGHTS, value);
    // light_puzzle:lights redraws on varp 1356 (its onVarTransmit, script 1338).
    vm.invokeEventHandler(manager.getWidgetByUid(LIGHT_PUZZLE_LIGHTS), "onVarTransmit");
};
manager.getGroup(322);
manager.triggerOnLoad(manager.getWidgetByUid(322 << 16));
setLights(unlit);
const lights = () => manager.getDynamicChildrenByParent(LIGHT_PUZZLE_LIGHTS);
assert.equal(lights().length, 25, "light_puzzle:lights holds the 25 bulbs");
const litCount = () => lights().filter((w: any) => w.itemId === ItemID.TRAIL_LIGHT_LIT).length;
assert.equal(litCount(), 25 - countBits(unlit), "lit bulbs are the clear bits of trail_lights");
const title = () => manager.getDynamicChildrenByParent(LIGHT_PUZZLE_STEEL_BORDER)[1]?.text;
assert.match(String(title()), /light box/i, "the steel border's second child is the title");

const click = (index: number) => {
    plugin.onMenuOptionClicked({ param1: LIGHT_PUZZLE_BUTTONS[index] } as MenuActionData);
    unlit ^= MASKS[index];
    setLights(unlit);
    plugin.onGameTick();
};
/** The fewest switches that clear `value`, straight from the masks, as letters. */
const fewest = (value: number) => {
    let best: number | null = null;
    for (let set = 0; set < 256; set++) {
        let v = value;
        for (let bit = 0; bit < 8; bit++) if (set & (1 << bit)) v ^= MASKS[bit];
        if (v === 0 && (best === null || countBits(set) < countBits(best))) best = set;
    }
    return COMBINATIONS.filter((_, bit) => best !== null && (best & (1 << bit))).join("");
};
plugin.onGameTick(); // the first state, before any click
click(0);
assert.equal(title(), "Light box - Solution: unknown", "with one switch known there is no answer yet");
// Two presses before the lights change can't be told apart: that change teaches nothing.
plugin.onMenuOptionClicked({ param1: LIGHT_PUZZLE_BUTTONS[1] } as MenuActionData);
click(2);
assert.equal(title(), "Light box - Solution: unknown", "the double press is not recorded as switch B");
// Press each switch once more; each change teaches the solver that switch.
for (let index = 0; index < 8; index++) click(index);
const answer = fewest(unlit);
assert.ok(answer.length > 0);
assert.equal(title(), `Light box - Solution: ${answer}`, "with every switch known the title names the fewest presses");
for (const letter of answer) click(COMBINATIONS.indexOf(letter as (typeof COMBINATIONS)[number]));
assert.equal(unlit, 0);
assert.equal(litCount(), 25);
assert.equal(title(), "Light box - Solution: solved!");

// ---- Varrock Museum quiz: the correct answer is coloured, and only once.
manager.getGroup(533);
const quiz = JSON.parse(readFileSync(resolve(__dirname, "../../server/plugins/world/data/natural-history-quiz.json"), "utf8"));
let questions = 0;
for (const entry of quiz.cases) {
    for (const question of entry.questions ?? []) {
        questions++;
        assert.equal(correctMuseumAnswer(question.question), question.answers[question.correct], `RuneLite's answer for "${question.question}"`);
    }
}
assert.ok(questions >= 42, "every question the server asks is checked");
const first = quiz.cases[0].questions[2];
manager.getWidgetByUid(VM_NATHIS_QUESTION).text = first.question;
VM_NATHIS_ANSWERS.forEach((uid, index) => (manager.getWidgetByUid(uid).text = first.answers[index]));
plugin.onGameTick();
const answerTexts = () => VM_NATHIS_ANSWERS.map((uid) => manager.getWidgetByUid(uid).text);
const correct = first.answers[first.correct];
assert.deepEqual(answerTexts(), first.answers.map((answer: string) => (answer === correct ? `<col=00f880>${answer}</col>` : answer)));
plugin.onGameTick();
assert.equal(answerTexts()[first.correct], `<col=00f880>${correct}</col>`, "an answer already coloured is not wrapped twice");

// ---- ClientImpl reads server inventories beyond inv/worn/bank (the puzzle's trail_puzzleinv).
vm.context.inventories ??= new Map(); // the game client always passes one (OsrsClient.initCacheDependent)
const client = new ClientImpl(osrsClient);
assert.equal(client.getItemContainer(InventoryID.TRAIL_PUZZLEINV), null, "no puzzle inventory before the server sends one");
const pieces = new Inventory(25);
vm.context.inventories.set(InventoryID.TRAIL_PUZZLEINV, pieces);
assert.equal(client.getItemContainer(InventoryID.TRAIL_PUZZLEINV), null, "a VM entry the server has not sent is not a container");
osrsClient.serverSentInventoryIds.add(InventoryID.TRAIL_PUZZLEINV);
assert.ok(client.getItemContainer(InventoryID.TRAIL_PUZZLEINV), "the puzzle's inventory is readable once sent");

// ---- Puzzle box overlay: solve, follow the player along the solution, and re-solve off it.
const BASE = 2749; // any contiguous run of piece ids works; the solver numbers from the lowest
const board = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, -1, 23];
const setBoard = (values: number[]) => values.forEach((value, slot) => pieces.setSlot(slot, value < 0 ? -1 : BASE + value, value < 0 ? 0 : 1));
setBoard(board);
assert.deepEqual(getItemIds(client.getItemContainer(InventoryID.TRAIL_PUZZLEINV)!.getItems(), true), board);
assert.equal(getItemIds([new Item(1, 1), new Item(2, 1)], true), null, "a board with no single blank is skipped, not thrown on");

manager.getGroup(306);
const piecesWidget = manager.getWidgetByUid(TRAIL_SLIDEPUZZLE_PIECES);
assert.ok(piecesWidget, "trail_slidepuzzle:pieces exists in the cache");
piecesWidget._absX = 100;
piecesWidget._absY = 120;

const host: PuzzleSolverOverlayHost = {
    getClient: () => client,
    displaySolution: () => true,
    displayRemainingMoves: () => true,
    drawDots: () => true,
    movesToShow: () => 4,
    dotColor: () => Color.YELLOW,
    dotEndColor: () => Color.RED,
    getSolveBackend: () => new InlineSolveBackend(),
    getArrow: () => null,
};
const overlay = new PuzzleSolverOverlay(host);
const drawLive = () => (overlay as any).render(new RecordingGraphics2D({ stringWidth: (t: string) => t.length * 6, getHeight: () => 16 }), true);
assert.equal(client.getGameState(), GameState.LOGGED_IN);
assert.match(overlay.signature(), /Solving\.\./, "before the first live draw nothing is solved");
drawLive(); // solves inline
const text = () => overlay.signature();
assert.match(text(), /Moves left: 1/, "one slide from solved");
setBoard([...board.slice(0, 23), 23, -1]);
drawLive();
assert.match(text(), /Solved!/, "the overlay follows the player along the solution");

// The dots sit on the board as drawn: the next move's slot, scaled with the board.
const dotAt = (width: number) => {
    piecesWidget._absWidth = width;
    piecesWidget._absHeight = width;
    setBoard(board); // the blank at slot 23; the next move takes it to slot 24 (column 4, row 4)
    overlay.reset();
    drawLive();
    const recording = new RecordingGraphics2D({ stringWidth: (t: string) => t.length * 6, getHeight: () => 16 });
    (overlay as any).render(recording, true);
    const dot = recording.ovals[0];
    return { centreX: dot.x + 1 + dot.width / 2, centreY: dot.y + 1 + dot.height / 2, size: dot.width };
};
assert.deepEqual(dotAt(250), { centreX: 100 + 4 * 50 + 25, centreY: 120 + 4 * 50 + 25, size: 24 }, "RuneLite's 50px tiles at scale 1");
assert.deepEqual(dotAt(500), { centreX: 100 + 4 * 100 + 50, centreY: 120 + 4 * 100 + 50, size: 48 }, "twice the size when the board is drawn at scale 2");
piecesWidget._absWidth = 250;
piecesWidget._absHeight = 250;

// A slide while a solve is still running changes the signature, so the live pass (which
// re-solves a stale board) still runs; RuneLite gets this from checking every frame.
{
    let solves = 0;
    const slow = new PuzzleSolverOverlay({ ...host, getSolveBackend: () => ({ solve: () => { solves++; return () => {}; }, dispose() {} }) });
    setBoard(board);
    const before = slow.signature();
    assert.match(before, /Solving\.\./);
    setBoard([...board.slice(0, 23), 23, -1]);
    assert.notEqual(slow.signature(), before, "the board is part of the signature while solving");
    (slow as any).render(new RecordingGraphics2D({ stringWidth: (t: string) => t.length * 6, getHeight: () => 16 }), true);
    assert.equal(solves, 1, "the live pass starts the solve");
}
console.log("Puzzle Solver: light box switches, museum answers and puzzle-box moves");

function countBits(value: number): number {
    let count = 0;
    for (let v = value; v; v &= v - 1) count++;
    return count;
}
