import assert from "node:assert/strict";
import { Cs2ArrayObject } from "../rs/cs2/Cs2ArrayObject";

// Opcode 8011 (array_fill_sequence): the cargo hold's grid (script 8872) fills a list of slot
// indices with it, sorts the slots' keys carrying that list along, then draws slot list[i] at
// position i (script 8871).
const slots = new Cs2ArrayObject("int", 0, 4, 4);
slots.fillSequence(0, -1, -1);
assert.deepEqual([0, 1, 2, 3].map((i) => slots.getInt(i)), [0, 1, 2, 3], "a negative range fills the whole array");

const keys = new Cs2ArrayObject("int", 0, 4, 4);
[5, 240 + 1, 65535, 0].forEach((key, i) => keys.setAt(i, key));
keys.sortAllWith(slots);
assert.deepEqual([0, 1, 2, 3].map((i) => slots.getInt(i)), [3, 0, 1, 2], "slots end up in key order");

const part = new Cs2ArrayObject("int", -1, 5, 5);
part.fillSequence(10, 1, 3);
assert.deepEqual([0, 1, 2, 3, 4].map((i) => part.getInt(i)), [-1, 10, 11, -1, -1], "a range fills only its slots");

console.log("cs2 array fill sequence check passed");
