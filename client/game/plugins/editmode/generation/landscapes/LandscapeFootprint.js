const SIZE = 64;
const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const key = (x, y) => `${x},${y}`;

function distanceSquared(x, y, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
}

function distanceTo(lines, x, y) {
  let least = Infinity;
  for (const line of lines) least = Math.min(least, distanceSquared(x, y, line));
  return Math.sqrt(least);
}

function landscapeFootprint(plan) {
  if (!plan.squares) return;
  const cells = plan.squares.map((id) => [(id >> 8) - (plan.x >> 6), (id & 255) - (plan.y >> 6)])
    .sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
  const byCell = new Map(cells.map((cell) => [key(...cell), cell]));
  const neighbours = ([x, y]) => SIDES.map(([dx, dy]) => byCell.get(key(x + dx, y + dy))).filter(Boolean);
  const outside = ([x, y]) => SIDES.filter(([dx, dy]) => !byCell.has(key(x + dx, y + dy)));
  const edges = [];
  for (const cell of cells) {
    const [x, y] = cell.map((v) => v * SIZE);
    for (const [dx, dy] of outside(cell)) {
      if (dx) {
        const edge = x + (dx > 0 ? SIZE : 0);
        edges.push([edge, y, edge, y + SIZE]);
      } else {
        const edge = y + (dy > 0 ? SIZE : 0);
        edges.push([x, edge, x + SIZE, edge]);
      }
    }
  }
  const irregular = cells.length * SIZE ** 2 !== plan.width * plan.height;
  const contains = (x, y) => byCell.has(key(Math.floor(x / SIZE), Math.floor(y / SIZE)));
  const edgeDistance = (x, y) => distanceTo(edges, x, y) * (contains(x, y) ? 1 : -1);
  return {
    irregular,
    edgeDistance,
    river: plan.landform === "river" && (irregular || plan.width > plan.height) &&
      riverRoute(cells, neighbours, outside, plan.seed),
  };
}

function riverRoute(cells, neighbours, outside, seed) {
  // Find the longest shortest route between boundary squares. Every step
  // crosses a shared edge, so the channel cannot jump a gap in the footprint.
  let route = [];
  const boundary = cells.filter((cell) => outside(cell).length);
  for (const start of boundary) {
    const pending = [start];
    const parents = new Map([[start, null]]);
    const distances = new Map([[start, 0]]);
    for (let i = 0; i < pending.length; i++) {
      const cell = pending[i];
      if (outside(cell).length && distances.get(cell) >= route.length) {
        route = [];
        for (let link = cell; link; link = parents.get(link)) route.unshift(link);
      }
      for (const next of neighbours(cell)) {
        if (parents.has(next)) continue;
        parents.set(next, cell);
        distances.set(next, distances.get(cell) + 1);
        pending.push(next);
      }
    }
  }
  if (route.length < 2) return;
  const exit = (cell, adjacent) => {
    const dx = cell[0] - adjacent[0], dy = cell[1] - adjacent[1];
    const directions = outside(cell);
    return directions.find(([x, y]) => x === dx && y === dy) ?? directions[seed % directions.length];
  };
  const start = exit(route[0], route[1]);
  const end = exit(route.at(-1), route.at(-2));
  const centres = route.map(([x, y]) => [x * SIZE + SIZE / 2, y * SIZE + SIZE / 2]);
  const [ax, ay] = centres[0];
  const [bx, by] = centres.at(-1);
  const points = [[ax + start[0] * SIZE, ay + start[1] * SIZE], ...centres,
    [bx + end[0] * SIZE, by + end[1] * SIZE]];
  const lines = [];
  const join = (from, to) => {
    if (from[0] !== to[0] || from[1] !== to[1]) lines.push([...from, ...to]);
  };
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    const [nx, ny] = points[i + 1];
    const before = [x + (px - x) / 3, y + (py - y) / 3];
    const after = [x + (nx - x) / 3, y + (ny - y) / 3];
    join(previous, before);
    previous = before;
    for (let step = 1; step <= 5; step++) {
      const t = step / 5, a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t;
      const point = [a * before[0] + b * x + c * after[0], a * before[1] + b * y + c * after[1]];
      join(previous, point);
      previous = point;
    }
  }
  join(previous, points.at(-1));
  return (x, y) => distanceTo(lines, x, y);
}

module.exports = { landscapeFootprint };
