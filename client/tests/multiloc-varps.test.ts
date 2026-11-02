import assert from "node:assert/strict";
import { multiLocVariants, multiLocVarps } from "../render/loc/MultiLocVarps";

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

// Variants: what each multiloc shows for the current vars, so an unrelated varbit on the same varp
// (one that changes no loc) leaves the square alone.
{
    const varLocs: Record<number, any> = {
        100: { transforms: [1, 2, -1], transformVarbit: -1, transformVarp: 42, transform(vars: any) {
            const index = vars.getVarp(42);
            return { id: index >= 0 && index < 2 ? this.transforms[index] : -1 };
        } },
        1: { id: 1 }, 2: { id: 2 },
    };
    const loader: any = { load: (id: number) => varLocs[id] };
    const ids = [Int32Array.from([100])];
    const vars = (value: number): any => ({ getVarp: () => value, getVarbit: () => 0 });
    assert.equal(multiLocVariants(ids, loader, vars(0)), multiLocVariants(ids, loader, vars(0)));
    assert.notEqual(multiLocVariants(ids, loader, vars(0)), multiLocVariants(ids, loader, vars(1)));
    assert.equal(multiLocVariants(undefined, loader, vars(0)), "");
}

// Loc id 0 is a multiloc too (Dwarf Cannon's remains, on varp 0): a varp-0 change rebuilds its
// square, and the variant follows the varp.
{
    const remains: Record<number, any> = {
        0: { transforms: [-1, -1, -1, 15596, -1], transformVarbit: -1, transformVarp: 0, transform(vars: any) {
            const index = vars.getVarp(0);
            return index >= 0 && index < 4 && this.transforms[index] !== -1 ? { id: this.transforms[index] } : undefined;
        } },
    };
    const loader: any = { load: (id: number) => remains[id] };
    const ids = [Int32Array.from([0])];
    assert.deepEqual([...multiLocVarps(ids, loader, varbitLoader)], [0], "loc 0 reads varp 0");
    const vars = (value: number): any => ({ getVarp: () => value, getVarbit: () => 0 });
    assert.equal(multiLocVariants(ids, loader, vars(3)), "0:15596", "varp 0 = 3 shows the remains");
    assert.equal(multiLocVariants(ids, loader, vars(2)), "0:-1");
}
