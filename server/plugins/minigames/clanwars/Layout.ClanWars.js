/** Cache242 templates. Landing/jail tiles and preparation rows are TSPS choices,
 * not recorded retail spawns. Sylvan copies both raw planes for bridge placement. */
const C = require("./Common.ClanWars");
const tile = (x, y) => Object.freeze([x, y, 0]);
const layouts = Object.freeze({
  1: Object.freeze({ name: "Plateau", origin: Object.freeze([3264, 4928]), size: 8,
    planes: Object.freeze([0]), landings: Object.freeze([tile(3293, 4933), tile(3293, 4986)]),
    jails: Object.freeze([tile(3323, 4943), tile(3323, 4976)]),
    barrier: "clanwars_barrier_darkrock", barrierY: 4959, barrierSkipBlocked: false,
    barrierRanges: Object.freeze([Object.freeze([3268, 3319])]),
    orb: "clanwars_viewing_start_darkrock", orbModel: 9752,
    jailPortal: "clanwars_prisonportal_darkrock",
    exits: Object.freeze(["clanwars_exitportal_darkrock_s", "clanwars_exitportal_darkrock_n"]) }),
  2: Object.freeze({ name: "Sylvan Glade", origin: Object.freeze([3392, 4992]), size: 8,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3424, 5000), tile(3424, 5048)]),
    jails: Object.freeze([tile(3423, 5020), tile(3424, 5027)]),
    barrier: "clanwars_barrier_elfwood", barrierY: 5023, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([3396, 3419]), Object.freeze([3428, 3451])]),
    orb: "clanwars_viewing_start_elfwood", orbModel: 9754,
    jailPortal: "clanwars_prisonportal_elfwood",
    exits: Object.freeze(["clanwars_exitportal_elfwood_s", "clanwars_exitportal_elfwood_n"]) }),
  3: Object.freeze({ name: "Forsaken Quarry", origin: Object.freeze([3392, 5056]), size: 8,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3424, 5066), tile(3424, 5109)]),
    jails: Object.freeze([tile(3428, 5085), tile(3419, 5090)]),
    barrier: "clanwars_barrier_greyrock", barrierY: 5087, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([3396, 3415]), Object.freeze([3432, 3451])]),
    orb: "clanwars_viewing_start_greyrock", orbModel: 9755,
    jailPortal: "clanwars_prisonportal_darkrock",
    exits: Object.freeze(["clanwars_exitportal_greyrock_s", "clanwars_exitportal_greyrock_n"]) }),
  5: Object.freeze({ name: "Clan Cup Arena", origin: Object.freeze([3136, 4928]), size: 8,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3150, 4960), tile(3185, 4960)]),
    jails: Object.freeze([tile(3141, 4957), tile(3194, 4957)]),
    barrier: "clanwars_barrier_greyrock", barrierAxis: "x", barrierX: 3167,
    barrierFace: 1, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([4936, 4983])]),
    orb: "clanwars_viewing_start_greyrock", orbModel: 9755,
    jailPortal: "clanwars_prisonportal_darkrock",
    exits: Object.freeze(["clanwars_exitportal_small_purple"]) }),
  6: Object.freeze({ name: "Soggy Swamp", origin: Object.freeze([3392, 4928]), size: 8,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3409, 4934), tile(3439, 4985)]),
    jails: Object.freeze([tile(3396, 4932), tile(3451, 4987)]),
    barrier: "clanwars_barrier_swamp", barrierY: 4959, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([3395, 3452])]),
    orb: "clanwars_viewing_start_swamp", orbModel: 9753,
    jailPortal: "clanwars_prisonportal_swamp",
    exits: Object.freeze(["clanwars_exitportal_swamp_s", "clanwars_exitportal_swamp_n"]) }),
  11: Object.freeze({ name: "Classic", origin: Object.freeze([3392, 4672]), width: 8, height: 16,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3423, 4690), tile(3423, 4787)]),
    jails: Object.freeze([tile(3448, 4727), tile(3448, 4744)]),
    barrier: "clanwars_barrier_darkrock", barrierY: 4735, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([3393, 3445])]),
    orb: "clanwars_viewing_start_darkrock", orbModel: 9752,
    jailPortal: "clanwars_prisonportal_darkrock",
    exits: Object.freeze(["clanwars_exitportal_darkrock_s"]) }),
  12: Object.freeze({ name: "Lumbridge Castle", origin: Object.freeze([3392, 4800]), size: 8,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3417, 4810), tile(3417, 4843)]),
    jails: Object.freeze([tile(3436, 4822), tile(3436, 4831)]),
    barrier: "clanwars_barrier_greyrock", barrierY: 4826, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([3407, 3437])]),
    orb: "clanwars_viewing_start_greyrock", orbModel: 9755,
    jailPortal: "clanwars_prisonportal_swamp",
    exits: Object.freeze(["clanwars_exitportal_smallwood_s", "clanwars_exitportal_smallwood_n"]) }),
  13: Object.freeze({ name: "Falador Park", origin: Object.freeze([3456, 4736]), width: 16, height: 8,
    planes: Object.freeze([0, 1]), landings: Object.freeze([tile(3472, 4759), tile(3512, 4759)]),
    jails: Object.freeze([tile(3461, 4760), tile(3469, 4745)]),
    barrier: "clanwars_barrier_elfwood", barrierAxis: "x", barrierX: 3496,
    barrierFace: 1, barrierSkipBlocked: true,
    barrierRanges: Object.freeze([Object.freeze([4743, 4767])]),
    orb: "clanwars_viewing_start_elfwood", orbModel: 9754,
    jailPortal: "clanwars_prisonportal_elfwood",
    exits: Object.freeze(["clanwars_exitportal_smallwood_s"]) }),
});
function get(id) { return Object.prototype.hasOwnProperty.call(layouts, id) ? layouts[id] : null; }
function owns(game, object, gamevals) {
  if (!object || object.getPrivateArea() !== game.area
    || !gamevals.some(name => C.core.CacheDefinitions.getLocId(name) === object.getId())) return false;
  // Cache copies, including bridge-lowered objects, are the native resolver's objects.
  for (const plane of game.layout.planes) {
    for (let x = 0; x < game.area.widthChunks; x++) for (let y = 0; y < game.area.heightChunks; y++) {
      if (game.area.getChunkObjects(plane, x, y).includes(object)) return true;
    }
  }
  return false;
}
module.exports = { get, owns };
