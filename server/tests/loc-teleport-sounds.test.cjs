// Run after `yarn build`: node --test tests/loc-teleport-sounds.test.cjs
//
// Loc teleport entries must not carry a combat sound. The sync script (scripts/loc-teleport-matching.cjs) writes the
// first sound the capture recorded around the climb, and when a monster or a player is fighting nearby that is
// the fight's: #2595 found a hurt sound (518) on stairs. These entries carry a weapon, hit or monster attack sound
// (names from the Wiki's List of sound IDs) that the decoded archives show is not the loc's:
//
//   loc, entry sound (Wiki name)               what the captures around the click show
//   dagannoth_caveentrance_rock 1615           dagannoth_attack: in 1 of 4 clicks (rsprox 1768), 9 ticks on, with a hit; 3 silent
//   dagexp_ladder29 1615                       dagannoth_attack: 1768 tick 6 of a fight (hits on ticks 4-7); no ladder sound
//   cof_gibbet_lift_down 1437,10094 400        demon_attack: at tick 0 of all 3 clicks (3285 twice, 819), each with a hit
//   chickenquest_chamber_exit 2844             blade2_4 (hit): 424 tick 2, a hit that tick
//   fossil_cave_stairs_2_lower 718             rock_crab_attack: 1857 tick 2, a hit that tick
//   lunar_mine_slanty_ladder_down 815          sukqa_attack: on ticks 0, 2, 6, 9 and 10 of the same click (1768), with hits
//   luc2 doors 2503, 2500, 2845, 2700          2H_slash, hacksword_slash, blade2_5, longbow: a fight at the door (2700 53 times)
//
// The golem stairs (518, 1314) are #2595's. Entries with such a sound and no capture in the decoded archives are not
// changed here: the lotr_ruins doors (775 armed_skeleton, 3347 lotr_zombie_attack, 3313 warhammer_skeleton_attack,
// 3326 lotr_terrordog_attack, 1383 floor_spikes), the hellhound caves (3717 dog_attack), wild_venanatis_exit
// (2961 dragon_shield_3), the araxxor tunnel entries at 3690,9836 and 3693,9836 (537 insect_attack) and others.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const data = require("../plugins/world/data/loc-teleports.json");

const WRONG = [
  ["dagannoth_caveentrance_rock", 2519, 3738, 1615],
  ["dagexp_ladder29", 1850, 4386, 1615],
  ["cof_gibbet_lift_down", 1437, 10094, 400],
  ["chickenquest_chamber_exit", 2441, 4381, 2844],
  ["fossil_cave_stairs_2_lower", 3633, 10262, 718],
  ["lunar_mine_slanty_ladder_down", 2142, 3944, 815],
  ["luc2_darksquall_base_main_door_active", 4104, 4799, 2503],
  ["luc2_darksquall_base_main_door_exit_active", 4113, 4841, 2500],
  ["luc2_dwt_door_strong_outer", 4117, 4689, 2845],
  ["luc2_dwt_door_strong_inner", 4096, 4791, 2700],
];

for (const [name, x, y, wrong] of WRONG) {
  test(`${name} at ${x},${y} does not play the fight's sound ${wrong}`, () => {
    const entries = data.locs.filter((entry) => entry.name === name && entry.x === x && entry.y === y);
    assert.ok(entries.length > 0, "the entry exists");
    for (const entry of entries) assert.notEqual(entry.sound, wrong, `a combat sound ${wrong} was recorded as the climb's`);
  });
}

test("every other entry on those locs keeps what it has", () => {
  const luc2 = data.locs.filter((entry) => entry.name.startsWith("luc2_"));
  assert.ok(luc2.length >= 4, "the luc2 entries are still there");
  assert.equal(data.locs.find((entry) => entry.name === "cof_gibbet_lift_down" && entry.y === 10068)?.sound, 1541, "the lift's other sound is untouched");
});
