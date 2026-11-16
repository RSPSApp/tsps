const fs = require("fs");
const path = require("path");
const { readArtwork, readLoginScreenSettings } = require("./ClientArtwork");

/**
 * Sprites the cache doesn't have, `data/sprites/<id>[-name].png`, from id 30000 like custom
 * interfaces: the welcome screen's rsps.app banner is 30000. The browser client fetches one the
 * first time a component shows it; runelite-gateway adds the same files to the cache it serves.
 */
const SPRITES_DIRECTORY = path.resolve(process.cwd(), "data/sprites");
const FILE_NAME = /^(\d+)(?:-[a-z0-9-]+)?\.png$/;
const WELCOME_BANNER_SPRITE = 30000;
let sprites = new Map();

function loadSprites(directory = SPRITES_DIRECTORY) {
  const loaded = new Map();
  if (!fs.existsSync(directory)) return loaded;
  for (const file of fs.readdirSync(directory).sort()) {
    const match = FILE_NAME.exec(file);
    if (match) loaded.set(Number(match[1]), fs.readFileSync(path.join(directory, file)).toString("base64"));
  }
  return loaded;
}

/** GET /api/sprites lists the ids; /api/sprites/<id> is { id, png } with the PNG in base64. */
function spritesResource(_query, segments) {
  if (!segments.length) {
    const ids = [...sprites.keys()];
    if (!sprites.has(WELCOME_BANNER_SPRITE) && readArtwork("banner")) ids.push(WELCOME_BANNER_SPRITE);
    return ids;
  }
  if (segments.length !== 1) return undefined;
  const id = Number(segments[0]);
  const png = (id === WELCOME_BANNER_SPRITE ? readArtwork("banner") : null) ?? sprites.get(id);
  return png === undefined ? undefined : { id, png };
}

function loginScreenResource(_query, segments) {
  if (segments.length) return undefined;
  const jpg = readArtwork("background");
  return { ...readLoginScreenSettings(), ...(jpg ? { jpg } : {}) };
}

module.exports = {
  name: "CustomSprites",
  description: "Serves the world's own sprites (data/sprites) to the browser client over the content API.",
  _test: { loadSprites, spritesResource },
  register(api) {
    sprites = loadSprites();
    api.registerContentEndpoint("sprites", spritesResource);
    api.registerContentEndpoint("login-screen", loginScreenResource);
    api.log("registered", { sprites: [...sprites.keys()] });
  },
};
