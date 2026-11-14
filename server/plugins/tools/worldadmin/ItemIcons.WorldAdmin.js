"use strict";

const zlib = require("node:zlib");
const indexByCore = new WeakMap();
const pngById = new Map();
const PNG_CACHE_LIMIT = 512;

function u16(data, offset) {
  if (offset < 0 || offset + 2 > data.length) throw new Error("Truncated cache sprite metadata.");
  return (data[offset] << 8) | data[offset + 1];
}

function decodeSprite(data, frameIndex = 0) {
  if (!data || data.length < 9) return null;
  const count = u16(data, data.length - 2);
  if (count < 1 || count > 65535 || !Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= count) return null;
  const metadataOffset = data.length - 7 - count * 8;
  if (metadataOffset < 0) return null;
  let offset = metadataOffset;
  const width = u16(data, offset); offset += 2;
  const height = u16(data, offset); offset += 2;
  const paletteSize = data[offset++] + 1;
  if (!width || !height || width > 512 || height > 512 || paletteSize > 256) return null;
  const xOffsets = new Array(count), yOffsets = new Array(count), widths = new Array(count), heights = new Array(count);
  for (let i = 0; i < count; i++, offset += 2) xOffsets[i] = u16(data, offset);
  for (let i = 0; i < count; i++, offset += 2) yOffsets[i] = u16(data, offset);
  for (let i = 0; i < count; i++, offset += 2) widths[i] = u16(data, offset);
  for (let i = 0; i < count; i++, offset += 2) heights[i] = u16(data, offset);
  const paletteOffset = metadataOffset - (paletteSize - 1) * 3;
  if (paletteOffset < 1) return null;
  const palette = new Uint32Array(paletteSize);
  offset = paletteOffset;
  for (let i = 1; i < paletteSize; i++) {
    palette[i] = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    if (palette[i] === 0) palette[i] = 1;
    offset += 3;
  }
  offset = 0;
  for (let frame = 0; frame < count; frame++) {
    const frameWidth = widths[frame], frameHeight = heights[frame], pixelCount = frameWidth * frameHeight;
    if (frameWidth > 512 || frameHeight > 512 || pixelCount > 262144 || offset >= paletteOffset) return null;
    const flags = data[offset++];
    const columnWise = (flags & 1) !== 0, hasAlpha = (flags & 2) !== 0;
    const selected = frame === frameIndex;
    const pixels = selected ? new Uint8Array(pixelCount) : null;
    const alpha = selected && hasAlpha ? new Uint8Array(pixelCount) : null;
    if (offset + pixelCount * (hasAlpha ? 2 : 1) > paletteOffset) return null;
    if (!columnWise) {
      if (selected) for (let i = 0; i < pixelCount; i++) pixels[i] = data[offset + i];
      offset += pixelCount;
    } else {
      for (let x = 0; x < frameWidth; x++) for (let y = 0; y < frameHeight; y++) {
        const value = data[offset++];
        if (selected) pixels[x + y * frameWidth] = value;
      }
    }
    if (hasAlpha) {
      if (!columnWise) {
        if (selected) for (let i = 0; i < pixelCount; i++) alpha[i] = data[offset + i];
        offset += pixelCount;
      } else {
        for (let x = 0; x < frameWidth; x++) for (let y = 0; y < frameHeight; y++) {
          const value = data[offset++];
          if (selected) alpha[x + y * frameWidth] = value;
        }
      }
    }
    if (selected) return { width, height, x: xOffsets[frame], y: yOffsets[frame], frameWidth, frameHeight, palette, pixels, alpha };
  }
  return null;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function encodePng(sprite) {
  if (!sprite) return null;
  const { width, height, x, y, frameWidth, frameHeight, palette, pixels, alpha } = sprite;
  if (!width || !height || width > 512 || height > 512 || !pixels || pixels.length !== frameWidth * frameHeight) return null;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    const rowOffset = row * (width * 4 + 1);
    rows[rowOffset] = 0;
    for (let column = 0; column < width; column++) {
      const sourceX = column - x, sourceY = row - y;
      if (sourceX < 0 || sourceY < 0 || sourceX >= frameWidth || sourceY >= frameHeight) continue;
      const source = sourceX + sourceY * frameWidth;
      const colorIndex = pixels[source];
      if (colorIndex === 0) continue;
      const color = palette[colorIndex] ?? 0;
      const destination = rowOffset + 1 + column * 4;
      rows[destination] = (color >>> 16) & 0xff;
      rows[destination + 1] = (color >>> 8) & 0xff;
      rows[destination + 2] = color & 0xff;
      rows[destination + 3] = alpha ? alpha[source] : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function readItemIcon(core, itemId) {
  const cache = core.CacheDefinitions;
  if (cache?.hasDefinition?.("item", itemId) === false || !cache?.getItem?.(itemId)) return null;
  let index = indexByCore.get(core);
  if (!index) {
    const { IndexType } = require("../../../dist/game/cache/codec/rs/cache/IndexType");
    index = core.CacheIndexDat2.fromStore(IndexType.DAT2.sprites, core.CachePipeline.getStore());
    indexByCore.set(core, index);
  }
  const load = (spriteId, frame = 0) => {
    if (!Number.isInteger(spriteId) || spriteId < 0) return null;
    try {
      // Some sprite references pack both archive and file IDs into one number; mirror the
      // browser client's SpriteLoader lookup order before treating it as an archive ID.
      const archiveId = (spriteId >>> 16) & 0xffff, fileId = spriteId & 0xffff;
      let file = archiveId !== 0 || fileId !== 0 ? index.getFile(archiveId, fileId) : undefined;
      if (!file) file = index.getFile(spriteId, 0);
      return file ? decodeSprite(file.data, frame) : null;
    } catch { return null; }
  };
  for (const token of [`inv,${itemId}`, `obj_icons,${itemId}`, `obj,${itemId}`, `item,${itemId}`]) {
    const sprite = load(index.getArchiveId(token));
    if (sprite) return sprite;
  }
  for (const pack of ["inv", "obj_icons", "obj", "items", "item_icons"]) {
    const sprite = load(index.getArchiveId(pack), itemId);
    if (sprite) return sprite;
  }
  // A raw item ID is not necessarily a sprite archive ID. Falling back to it displays
  // unrelated icons (e.g. a log may become a map symbol), so leave the name fallback visible.
  return null;
}

function itemIconDataUri(core, itemId) {
  const cached = pngById.get(itemId);
  if (cached) return cached;
  const sprite = readItemIcon(core, itemId);
  const png = encodePng(sprite);
  if (!png) return null;
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  pngById.set(itemId, dataUri);
  if (pngById.size > PNG_CACHE_LIMIT) pngById.delete(pngById.keys().next().value);
  return dataUri;
}

module.exports = { itemIconDataUri, _test: { decodeSprite, encodePng, crc32 } };
