import assert from "node:assert/strict";
import { multiLocVarps } from "../render/loc/MultiLocVarps";

// A totem site's base (multiloc on a varbit of varp 4770), a varp multiloc and a plain loc.
const locs: Record<number, any> = {
    57028: { transforms: [57064, 57066], transformVarbit: 17649, transformVarp: -1 },
    100: { transforms: [1, 2], transformVarbit: -1, transformVarp: 42 },
    200: { transforms: undefined, transformVarbit: -1, transformVarp: -1 },
};
const locTypeLoader: any = { load: (id: number) => locs[id] };
const varbitLoader: any = { load: (id: number) => (id === 17649 ? { baseVar: 4770 } : undefined) };

const square = [Int32Array.from([200, 57028, 57028]), Int32Array.from([100])];
assert.deepEqual([...multiLocVarps(square, locTypeLoader, varbitLoader)].sort((a, b) => a - b), [42, 4770],
    "a multiloc's varbit counts as its base varp; plain locs read nothing");
assert.equal(multiLocVarps(square, locTypeLoader, varbitLoader), multiLocVarps(square, locTypeLoader, varbitLoader),
    "cached per build");
assert.equal(multiLocVarps(undefined, locTypeLoader, varbitLoader).size, 0, "a square without loc data");

console.log("multiloc-varps: ok");
