/**
 * Leagues VI's separate Yama's Lair plays Sign Here (Wiki: Yama's Lair). The normal
 * domain's music map covers different tiles; the league lair occupies cache map square 5975.
 * Use the area's music policy so entry, relog and music modes follow the normal session path.
 */
const YAMA_LAIR_REGION = 5975;
const SIGN_HERE_TRACK = 280;

function createLair(api) {
  const { Area, Boundary } = api.core;
  const x = (YAMA_LAIR_REGION >> 8) << 6;
  const y = (YAMA_LAIR_REGION & 0xff) << 6;
  const boundary = new Boundary(x, x + 63, y, y + 63, 0);
  return new (class YamasLair extends Area {
    constructor() { super([boundary]); }

    getMusicTrack(player) {
      // Membership can trail a teleport by a tick; never override the destination's music.
      return boundary.inside(player.getLocation()) ? SIGN_HERE_TRACK : null;
    }
  })();
}

module.exports = function attach(api) {
  api.registerArea(createLair(api));
};
