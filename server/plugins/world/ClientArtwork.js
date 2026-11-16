const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 700 * 1024;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function isArtworkId(id) {
  return id === "banner" || id === "background";
}

function isBackgroundJpeg(bytes) {
  if (bytes.length < 11 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  // Check the dimensions before clients allocate the decoded bitmap.
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || offset + 2 > bytes.length) return false;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (size < 8) return false;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && width <= 1280 && height > 0 && height <= 720;
    }
    offset += size;
  }
  return false;
}

function isValidArtwork(id, data) {
  if (!isArtworkId(id) || typeof data !== "string" || !data.length || data.length > Math.ceil(MAX_BYTES / 3) * 4) return false;
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_BYTES || bytes.toString("base64") !== data) return false;
  if (id === "banner") {
    return bytes.length >= 45 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
      && bytes.toString("ascii", 12, 16) === "IHDR"
      && bytes.readUInt32BE(16) === 699 && bytes.readUInt32BE(20) === 191
      && bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND";
  }
  return isBackgroundJpeg(bytes);
}

function artworkFile(id) {
  if (!isArtworkId(id)) throw new Error("Unknown client image");
  return path.resolve("data/client-artwork", id + ".json");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function readArtwork(id) {
  const data = readJson(artworkFile(id));
  return isValidArtwork(id, data) ? data : null;
}

function readLoginScreenSettings() {
  const data = readJson(path.resolve("data/client-artwork/login-screen.json"));
  return { showFlames: data?.showFlames !== false, showLogo: data?.showLogo !== false };
}

function saveArtwork(id, data) {
  if (data !== null && !isValidArtwork(id, data)) throw new Error("Invalid client image");
  const file = artworkFile(id);
  if (data === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(data));
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { isArtworkId, isValidArtwork, readArtwork, readLoginScreenSettings, saveArtwork };
