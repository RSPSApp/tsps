const geometry = require("./Geometry");

function createStylePlanner(readStyles, sizeOf) {
  const styleNamed = (name) => {
    const styles = readStyles();
    const style = Object.hasOwn(styles, name) ? styles[name] : null;
    if (!style) throw new Error(`No style "${name}"; list_styles shows what exists`);
    return style;
  };

  function diagonalJoinOf(style) {
    if (style.diagonal == null) return null;
    return [style.cornerPost, style.diagonal].find((id) => id != null && sizeOf(id, 1)) ?? null;
  }

  /** Placements for a wall in `style` along `points`; shared with the generators. */
  const planWall = (style, points, { closed = false, gates = [], towerEvery = 0, towerSize = 2, z: plane = 0, side = "left", facing = "out", seed } = {}) => {
    const diagonalJoin = diagonalJoinOf(style);
    const { pieces, openings } = geometry.wallPath(points, {
      closed, gaps: gates, side, facing, corners: style.cornerPost !== null, diagonalJoins: diagonalJoin !== null,
    });
    const placements = [];
    const byTile = new Map();
    for (const piece of pieces) {
      // Shape 1 corner pieces come from the wall loc, as on Varrock's houses.
      const straight = piece.type === 0;
      const choices = style.wallVariants ?? [];
      const [x, y] = points[0];
      const variation = Math.imul(piece.x - x, 374761393) ^ Math.imul(piece.y - y, 668265263) ^ Math.imul(seed, 1274126177);
      const variant = straight && seed !== undefined && choices.length > 0 && (variation & 3) === 0
        ? choices[(variation >>> 2) % choices.length] : style.wall;
      const id = piece.diagonalJoin ? diagonalJoin
        : piece.type === 2 ? style.corner ?? style.wall : piece.type === 9 ? style.diagonal ?? style.wall
        : piece.type === 1 && style.cornerPost ? style.cornerPost : variant;
      byTile.set(`${piece.x},${piece.y},${piece.type}`, { id, ...piece });
    }
    // Towers: a square of wall round every towerEvery-th corner along the path, replacing the
    // run inside it.
    if (towerEvery > 0) {
      const corners = closed && points.length > 2 ? [...points, points[0]] : points;
      const along = [];
      for (let i = 0; i + 1 < corners.length; i++) {
        let [x, y] = corners[i];
        const [tx, ty] = corners[i + 1];
        while (x !== tx || y !== ty) {
          along.push([x, y]);
          x += Math.sign(tx - x);
          y += Math.sign(ty - y);
        }
      }
      if (!closed) along.push(corners[corners.length - 1]);
      const half = Math.floor(towerSize / 2);
      for (let i = 0; i < along.length; i += towerEvery) {
        const [cx, cy] = along[i];
        const x0 = cx - half;
        const y0 = cy - half;
        for (const key of [...byTile.keys()]) {
          const [tx, ty] = key.split(",").map(Number);
          if (tx >= x0 && tx < x0 + towerSize && ty >= y0 && ty < y0 + towerSize) byTile.delete(key);
        }
        const square = [[x0, y0], [x0 + towerSize, y0], [x0 + towerSize, y0 + towerSize], [x0, y0 + towerSize]];
        for (const piece of geometry.wallPath(square, { closed: true, facing }).pieces) {
          byTile.set(`${piece.x},${piece.y},${piece.type}`, { id: piece.type === 2 ? style.corner ?? style.wall : style.wall, ...piece });
        }
      }
    }
    for (const piece of byTile.values()) placements.push({ id: piece.id, x: piece.x, y: piece.y, z: plane, type: piece.type, face: piece.face });
    const hang = style.gate ?? style.door;
    for (const opening of openings) {
      if (hang !== null && hang !== undefined && opening.type === 0) {
        placements.push({ id: hang, x: opening.x, y: opening.y, z: plane, type: 0, face: opening.face });
      }
    }
    return { placements, openings };
  };


  return { styleNamed, diagonalJoinOf, planWall };
}
module.exports = { createStylePlanner };
