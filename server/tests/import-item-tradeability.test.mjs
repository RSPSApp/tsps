import assert from "node:assert/strict";
import { test } from "node:test";
import { importTradeability } from "../scripts/import-osrs-item-tradeability.mjs";

const row = (extra = {}) => ({ id: 34065, name: "Shark lure pack", playerTradeable: false,
    noteable: true, sourcePage: "Shark lure pack", sourceVersion: null, ...extra });
const source = (rows) => ({ schema: 1, input_sha256: "a".repeat(64), rows });
const cached = (rows) => new Map(rows.map((r) => [r.id, r]));

test("imports exact source booleans and audits every cache policy disagreement", () => {
    const result = importTradeability(source([row(), row({ id: 8903, name: "Black mask (9)",
        playerTradeable: true, sourcePage: "Black mask", sourceVersion: 10 })]), cached([
        { id: 34065, name: "Shark lure pack", playerTradeable: true, ge: false },
        { id: 8903, name: "Black mask (9)", playerTradeable: true, ge: false },
    ]));
    assert.deepEqual(result.definitions.rows.map((r) => [r.id, r.playerTradeable]), [[8903, true], [34065, false]]);
    assert.deepEqual(result.report.disagreements.map((r) => r.id), [34065]);
    assert.equal(result.report.accepted, 2);
    assert.equal(JSON.stringify(result), JSON.stringify(importTradeability(source([row(), row({ id: 8903,
        name: "Black mask (9)", playerTradeable: true, sourcePage: "Black mask", sourceVersion: 10 })]), cached([
        { id: 34065, name: "Shark lure pack", playerTradeable: true, ge: false },
        { id: 8903, name: "Black mask (9)", playerTradeable: true, ge: false },
    ]))));
});

test("stale IDs and variant-name mismatches are reported without becoming overlays", () => {
    const result = importTradeability(source([row(), row({ id: 28887, name: "Moonlight antler" })]), cached([
        { id: 34065, name: "Different reused item", playerTradeable: true, ge: false },
    ]));
    assert.equal(result.definitions.rows.length, 0);
    assert.deepEqual(result.report.rejected.map((r) => [r.id, r.reason]),
        [[28887, "unknown-cache-id"], [34065, "cache-name-mismatch"]]);
});

test("a same-name stale Wiki ID cannot overlay an active bank placeholder", () => {
    const result = importTradeability(source([row({ id: 31368, name: "Accordion", playerTradeable: true })]),
        cached([{ id: 31368, name: "Accordion", playerTradeable: false, ge: false, placeholder: true }]));
    assert.equal(result.definitions.rows.length, 0);
    assert.equal(result.report.rejected[0].reason, "cache-placeholder");
});

test("rejects malformed source contracts and duplicate IDs rather than guessing defaults", () => {
    const cache = cached([{ id: 34065, name: "Shark lure pack", playerTradeable: true, ge: false }]);
    for (const bad of [{ schema: 2, rows: [] }, source([row({ playerTradeable: "No" })]),
        source([row({ id: -1 })]), source([row(), row()]), source([row({ sourcePage: "" })]),
        source([row({ sourceVersion: 0 })])]) assert.throws(() => importTradeability(bad, cache));
    assert.equal(importTradeability(source([]), cache).definitions.rows.length, 0, "unknown source stays absent");
});
