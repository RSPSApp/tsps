"use strict";

(function attachBotMapView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LocalBotMapView = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createBotMapView() {
  const TILE_SIZE = 64;
  const MAX_REGION_X = 99;
  const MAX_REGION_Y = 255;
  const MAX_TILE_NODES = 512;
  const DEFAULT_TILE_BASE = "https://rsps.app/api/rsps/minimap";
  const BOT_COLORS = ["#e7c66e", "#7fc5a1", "#80b9e7", "#cf98dc", "#e58e77", "#83d2d3", "#d9a76f", "#aeb9ef"];
  const tileNodes = new Map();

  function tileUrl(regionX, regionY, plane, baseUrl = DEFAULT_TILE_BASE) {
    if (!Number.isInteger(regionX) || regionX < 0 || regionX > MAX_REGION_X) throw new RangeError("Invalid minimap region X.");
    if (!Number.isInteger(regionY) || regionY < 0 || regionY > MAX_REGION_Y) throw new RangeError("Invalid minimap region Y.");
    if (!Number.isInteger(plane) || plane < 0 || plane > 3) throw new RangeError("Invalid minimap plane.");
    const separator = String(baseUrl).includes("?") ? "&" : "?";
    return `${baseUrl}${separator}x=${regionX * TILE_SIZE + TILE_SIZE / 2}&y=${regionY * TILE_SIZE + TILE_SIZE / 2}&z=${plane}&zoom=4&size=256`;
  }

  function visibleRegions(center, width, height, scale, maxTiles = 48) {
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) ||
        !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 ||
        !Number.isFinite(scale) || scale <= 0 || !Number.isInteger(maxTiles) || maxTiles < 1) return [];
    const halfWidth = width / (2 * scale);
    const halfHeight = height / (2 * scale);
    const minX = Math.max(0, Math.floor((center.x - halfWidth) / TILE_SIZE));
    const maxX = Math.min(MAX_REGION_X, Math.floor((center.x + halfWidth) / TILE_SIZE));
    const minY = Math.max(0, Math.floor((center.y - halfHeight) / TILE_SIZE));
    const maxY = Math.min(MAX_REGION_Y, Math.floor((center.y + halfHeight) / TILE_SIZE));
    const regions = [];
    for (let regionX = minX; regionX <= maxX; regionX++) {
      for (let regionY = minY; regionY <= maxY; regionY++) {
        const dx = regionX * TILE_SIZE + TILE_SIZE / 2 - center.x;
        const dy = regionY * TILE_SIZE + TILE_SIZE / 2 - center.y;
        regions.push({ regionX, regionY, distance: Math.hypot(dx, dy) });
      }
    }
    return regions.sort((a, b) => a.distance - b.distance || a.regionX - b.regionX || a.regionY - b.regionY).slice(0, maxTiles);
  }

  function screenPoint(point, center, scale, width, height) {
    return {
      x: (point.x - center.x) * scale + width / 2,
      y: (center.y - point.y) * scale + height / 2,
    };
  }

  function regionImageBounds(regionX, regionY, center, scale, width, height) {
    return {
      left: (regionX * TILE_SIZE - center.x) * scale + width / 2,
      top: (center.y - (regionY + 1) * TILE_SIZE) * scale + height / 2,
      width: TILE_SIZE * scale,
      height: TILE_SIZE * scale,
    };
  }

  function trailSegments(points, plane, maxGapMs = 30000, maxDistance = TILE_SIZE) {
    const segments = [];
    let segment = [];
    for (const point of points ?? []) {
      if (point?.z !== plane || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const previous = segment.at(-1);
      if (previous && (point.at - previous.at > maxGapMs || Math.hypot(point.x - previous.x, point.y - previous.y) > maxDistance)) {
        if (segment.length) segments.push(segment);
        segment = [];
      }
      segment.push(point);
    }
    if (segment.length) segments.push(segment);
    return segments;
  }

  function botsWithLocation(bots) {
    return (bots ?? []).filter(bot => {
      const x = Number(bot.location?.x), y = Number(bot.location?.y), z = Number(bot.location?.z);
      return Number.isInteger(x) && x >= 0 && x < 16384 && Number.isInteger(y) && y >= 0 && y < 16384 &&
        Number.isInteger(z) && z >= 0 && z <= 3;
    }).sort((a, b) => String(a.username).localeCompare(String(b.username)));
  }

  function botsOnPlane(bots, plane) {
    return botsWithLocation(bots).filter(bot => Number(bot.location.z) === Number(plane));
  }

  function botColor(bots, username, plane) {
    const index = botsOnPlane(bots, plane).findIndex(bot => bot.username === username);
    return index < 0 ? BOT_COLORS[0] : BOT_COLORS[index % BOT_COLORS.length];
  }

  function imageNode(url) {
    if (typeof document === "undefined") return null;
    let image = tileNodes.get(url);
    if (image) {
      tileNodes.delete(url);
      tileNodes.set(url, image);
      return image;
    }
    image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.src = url;
    tileNodes.set(url, image);
    while (tileNodes.size > MAX_TILE_NODES) tileNodes.delete(tileNodes.keys().next().value);
    return image;
  }

  function render(container, options = {}) {
    if (!container || typeof document === "undefined") return { tiles: 0, markers: 0 };
    const width = Math.max(1, Math.round(container.clientWidth || options.width || 760));
    const height = Math.max(1, Math.round(container.clientHeight || options.height || 460));
    const center = options.center ?? { x: 3222, y: 3218 };
    const plane = Number(options.plane ?? 0);
    const scale = Number(options.scale ?? 4);
    const svgNs = "http://www.w3.org/2000/svg";
    const tiles = document.createElement("div");
    tiles.className = "local-bot-aerial-tiles";
    const regions = visibleRegions(center, width, height, scale, options.maxTiles ?? 48);
    let loaded = 0;
    let failed = 0;
    const reportStatus = () => options.onStatus?.({ tiles: regions.length, loaded, failed, markers: 0 });
    for (const { regionX, regionY } of regions) {
      const image = imageNode(tileUrl(regionX, regionY, plane, options.tileBase ?? DEFAULT_TILE_BASE));
      if (!image) continue;
      image.className = "local-bot-aerial-tile";
      const bounds = regionImageBounds(regionX, regionY, center, scale, width, height);
      image.style.left = `${bounds.left}px`;
      image.style.top = `${bounds.top}px`;
      image.style.width = `${bounds.width}px`;
      image.style.height = `${bounds.height}px`;
      if (image.complete && image.naturalWidth > 0) loaded++;
      else if (image.complete && image.naturalWidth === 0) failed++;
      image.onload = () => { loaded++; reportStatus(); };
      image.onerror = () => { failed++; reportStatus(); };
      tiles.append(image);
    }

    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `Overhead map, plane ${plane}`);
    let markerCount = 0;
    const add = (tag, attributes = {}, text = null) => {
      const node = document.createElementNS(svgNs, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      if (text !== null) node.textContent = text;
      svg.append(node);
      return node;
    };
    const visibleBots = botsOnPlane(options.bots, plane);
    const colorsByUsername = new Map(visibleBots.map((bot, index) => [bot.username, BOT_COLORS[index % BOT_COLORS.length]]));
    for (const [index, trail] of (options.trails ?? []).entries()) {
      const color = colorsByUsername.get(trail.username) ?? BOT_COLORS[index % BOT_COLORS.length];
      for (const segment of trailSegments(trail.points, plane)) {
        if (segment.length < 2) continue;
        const points = segment.map(point => {
          const position = screenPoint(point, center, scale, width, height);
          return `${position.x},${position.y}`;
        }).join(" ");
        const line = add("polyline", {
          points, fill: "none", stroke: color, "stroke-width": trail.username === options.selectedUsername ? 3 : 1.75,
          "stroke-linecap": "round", "stroke-linejoin": "round", opacity: trail.username === options.selectedUsername ? 0.9 : 0.52,
          class: "local-bot-aerial-trail",
        });
        const title = document.createElementNS(svgNs, "title");
        title.textContent = `${trail.displayName}: ${segment.length} trail samples on plane ${plane}`;
        line.append(title);
      }
    }

    visibleBots.forEach((bot, index) => {
      const location = { x: Number(bot.location.x), y: Number(bot.location.y) };
      if (!Number.isFinite(location.x) || !Number.isFinite(location.y)) return;
      const point = screenPoint(location, center, scale, width, height);
      if (point.x < -20 || point.y < -20 || point.x > width + 20 || point.y > height + 20) return;
      const selected = bot.username === options.selectedUsername;
      const color = BOT_COLORS[index % BOT_COLORS.length];
      const marker = add("g", {
        transform: `translate(${point.x} ${point.y})`, class: `local-bot-aerial-marker${selected ? " selected" : ""}`,
        tabindex: "0", role: "button", "data-bot": bot.username,
        "aria-label": `${bot.displayName ?? bot.username}, ${bot.activityId ?? bot.mode ?? "bot"}, tile ${location.x}, ${location.y}, plane ${plane}`,
      });
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("r", selected ? "7" : "5");
      circle.setAttribute("fill", color);
      circle.setAttribute("stroke", "#101113");
      circle.setAttribute("stroke-width", "2");
      marker.append(circle);
      const title = document.createElementNS(svgNs, "title");
      title.textContent = `${bot.displayName ?? bot.username} · ${bot.activityId ?? bot.mode ?? "bot"} · ${location.x}, ${location.y}, plane ${plane}`;
      marker.append(title);
      if (selected) {
        const label = document.createElementNS(svgNs, "text");
        label.setAttribute("x", "10");
        label.setAttribute("y", "-8");
        label.setAttribute("class", "local-bot-aerial-label");
        label.textContent = bot.displayName ?? bot.username;
        marker.append(label);
      }
      const select = () => options.onSelect?.(bot.username, bot.location);
      marker.addEventListener("click", select);
      marker.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
      });
      markerCount++;
      svg.append(marker);
    });

    container.replaceChildren(tiles, svg);
    options.onStatus?.({ tiles: regions.length, loaded, failed, markers: markerCount });
    return { tiles: regions.length, markers: markerCount };
  }

  return { TILE_SIZE, DEFAULT_TILE_BASE, tileUrl, visibleRegions, screenPoint, regionImageBounds, trailSegments, botsWithLocation, botsOnPlane, botColor, render };
});
