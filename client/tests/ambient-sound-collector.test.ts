import assert from "node:assert/strict";
import { AmbientSoundCollector } from "../game/audio/AmbientSoundCollector";

// Loc 100 hums (ambient sound 5); loc 200 is silent.
const locs: Record<number, any> = {
    100: { ambientSoundId: 5, soundMaxDistance: 4, sizeX: 1, sizeY: 1 },
    200: { ambientSoundId: -1 },
};
const updates: any[][] = [];
const collector = new AmbientSoundCollector(
    () => ({ updateAmbientSounds: (instances: any[]) => updates.push(instances.map((i) => ({ ...i }))) }) as any,
    () => ({ load: (id: number) => locs[id] }) as any,
    () => ({}) as any,
);

// One 2x2 level of map square (50, 50): the hum at local (1, 0), the silent loc at (0, 1).
const level0 = { offsets: [0, 0, 1, 2, 2], ids: [100, 200], typeRots: [1 << 6, 0] };
const map = {
    mapX: 50,
    mapY: 50,
    tileLocOffsetsByLevel: [level0.offsets],
    tileLocIdsByLevel: [level0.ids],
    tileLocTypeRotByLevel: [level0.typeRots],
};

collector.frame([map]);
collector.frame([map]);
assert.deepEqual(updates.map((u) => u.length), [0, 0], "nothing is collected before the third frame");
collector.frame([map]);
const [hum] = updates[2];
assert.equal(updates[2].length, 1, "only the loc that makes sound");
assert.deepEqual([hum.locId, hum.soundId, hum.x, hum.y, hum.z, hum.orientation], [100, 5, (3200 + 1) * 128 + 64, 3200 * 128 + 64, 0, 1]);

// A loc change brings new arrays: the hum is gone on the next collect.
map.tileLocIdsByLevel = [[200, 200]];
for (let i = 0; i < 3; i++) collector.frame([map]);
assert.equal(updates.at(-1)!.length, 0, "the changed map is read again");

console.log("ambient-sound-collector.test.ts: all tests passed");
