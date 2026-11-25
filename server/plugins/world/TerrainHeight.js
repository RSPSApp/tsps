function terrainNoise(x, y) {
  let n = x + y * 57;
  n = (n << 13) ^ n;
  const raw = (Math.imul(n, Math.imul(Math.imul(n, n), 15731) + 789221) + 1376312589) & 0x7fffffff;
  return (raw >> 19) & 0xff;
}

function terrainSmoothNoise(x, y) {
  const corners =
    terrainNoise(x - 1, y - 1) + terrainNoise(x + 1, y - 1) + terrainNoise(x - 1, y + 1) + terrainNoise(x + 1, y + 1);
  const sides = terrainNoise(x - 1, y) + terrainNoise(x + 1, y) + terrainNoise(x, y - 1) + terrainNoise(x, y + 1);
  const center = terrainNoise(x, y);
  return ((corners >> 4) + (sides >> 3) + (center >> 2)) | 0;
}

function terrainInterpolate(a, b, angle, frequencyReciprocal) {
  const theta = (angle * Math.PI) / frequencyReciprocal;
  const cosine = (65536 - ((Math.cos(theta) * 65536) | 0)) >> 1;
  return ((a * (65536 - cosine)) >> 16) + ((b * cosine) >> 16);
}

function terrainInterpolatedNoise(x, y, frequencyReciprocal) {
  const l = Math.floor(x / frequencyReciprocal);
  const i1 = x & (frequencyReciprocal - 1);
  const j1 = Math.floor(y / frequencyReciprocal);
  const k1 = y & (frequencyReciprocal - 1);
  const l1 = terrainSmoothNoise(l, j1);
  const i2 = terrainSmoothNoise(l + 1, j1);
  const j2 = terrainSmoothNoise(l, j1 + 1);
  const k2 = terrainSmoothNoise(l + 1, j1 + 1);
  const l2 = terrainInterpolate(l1, i2, i1, frequencyReciprocal);
  const i3 = terrainInterpolate(j2, k2, i1, frequencyReciprocal);
  return terrainInterpolate(l2, i3, k1, frequencyReciprocal);
}

function terrainVertexHeight(x, y, nativeRounding = true) {
  let mapHeight =
    terrainInterpolatedNoise(x + 45365, y + 91923, 4) -
    128 +
    ((terrainInterpolatedNoise(x + 10294, y + 37821, 2) - 128) >> 1) +
    ((terrainInterpolatedNoise(x, y, 1) - 128) >> 2);
  const scaled = mapHeight * 0.3;
  mapHeight = nativeRounding ? (scaled | 0) + 35 : (scaled + 35) | 0;
  if (mapHeight < 10) {
    mapHeight = 10;
  } else if (mapHeight > 60) {
    mapHeight = 60;
  }
  return mapHeight;
}

function nativeTerrainHeight(x, y) {
  return terrainVertexHeight(x + 932731, y + 556238);
}

function tileNoise(x, y, seed) {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 2147483647)) |
    0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return n & 0xff;
}

function smoothedNoise(x, y, seed) {
  const corners =
    tileNoise(x - 1, y - 1, seed) +
    tileNoise(x + 1, y - 1, seed) +
    tileNoise(x - 1, y + 1, seed) +
    tileNoise(x + 1, y + 1, seed);
  const sides =
    tileNoise(x - 1, y, seed) +
    tileNoise(x + 1, y, seed) +
    tileNoise(x, y - 1, seed) +
    tileNoise(x, y + 1, seed);
  const center = tileNoise(x, y, seed);
  return ((corners >> 4) + (sides >> 3) + (center >> 2)) & 0xff;
}

function proceduralTerrainHeight(worldX, worldY, plane, seed) {
  // Match classic RS317 terrain amplitude (10..60) and plane offset behavior.
  // Seed shifts the sampled domain to keep deterministic but varied outputs.
  const seedShiftX = ((seed >>> 8) & 0x3ff) - 512;
  const seedShiftY = ((seed >>> 18) & 0x3ff) - 512;
  const baseHeight = terrainVertexHeight(worldX + seedShiftX, worldY + seedShiftY, false);
  const detailNoise = smoothedNoise(worldX, worldY, seed) - 128;
  const detailed = baseHeight + Math.round(detailNoise / 24);
  const planePenalty = plane * 30;
  return Math.max(4, Math.min(120, detailed - planePenalty));
}

module.exports = { nativeTerrainHeight, proceduralTerrainHeight, tileNoise, smoothedNoise };
