import assert from "node:assert/strict";

import { headingIndexToward, steerFromHelm } from "../game/sailing/HelmSteering";
import { WorldEntity } from "../game/worldview/WorldEntity";

const tile = (t: number) => t * 128 + 64;

// Packed headings: 0 = south, 4 = west, 8 = north, 12 = east.
assert.equal(headingIndexToward(tile(100), tile(100), tile(100), tile(90)), 0);
assert.equal(headingIndexToward(tile(100), tile(100), tile(90), tile(100)), 4);
assert.equal(headingIndexToward(tile(100), tile(100), tile(100), tile(110)), 8);
assert.equal(headingIndexToward(tile(100), tile(100), tile(110), tile(100)), 12);
assert.equal(headingIndexToward(tile(100), tile(100), tile(104), tile(104)), 10, "north-east");
assert.equal(headingIndexToward(tile(100), tile(100), tile(100), tile(100)), undefined);

// Measured from the drawn position, not the tile: a boat drawn 0.9 tiles east of a tile's
// centre steering at the tile three rows north of that tile turns north-west-ish, not north.
assert.equal(headingIndexToward(tile(100) + 115, tile(100), tile(100), tile(103)), 7);

function setup(atHelm: boolean, deckTile = false) {
    const boat = new WorldEntity(3000);
    boat.setPosition({ x: tile(100), y: 0, z: tile(100), orientation: 1024 });
    const sent: number[] = [];
    const deps = {
        getVarbit: () => (atHelm ? 1 : 0),
        getLocalWorldViewId: () => 3000,
        getWorldEntity: () => boat,
        isDeckTile: () => deckTile,
        // The deck tile clicked sits 5 tiles east of the boat in the world.
        projectDeckToWorld: () => ({ x: tile(105), y: tile(100) }),
        // The click met the water 5 tiles north of the boat.
        pickClickedSeaPoint: () => ({ x: tile(100), y: tile(105) }),
        sendSetHeading: (heading: number) => sent.push(heading),
    };
    return { deps, sent };
}

{
    const { deps, sent } = setup(false);
    assert.equal(steerFromHelm(deps, 100, 110), false, "walks when not at the helm");
    assert.deepEqual(sent, []);
}
{
    const { deps, sent } = setup(true);
    assert.equal(steerFromHelm(deps, 100, 110), true);
    assert.deepEqual(sent, [8]);
}
{
    const { deps, sent } = setup(true, true);
    assert.equal(steerFromHelm(deps, 9603, 9604), true, "deck-scene clicks aim at the sea point");
    assert.deepEqual(sent, [8]);
}

console.log("helm-steering: ok");
