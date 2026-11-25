// The shape-9 model at rotation 0 runs from its south-west to its north-east corner.
function diagonalWallFace(dx, dy, flip = false) {
  return (dx === dy ? 0 : 1) + (flip ? 2 : 0);
}

// Native Falador and Lumbridge castle walls fill the thick side of each diagonal
// seam with a shape-1 piece facing the same way as the diagonal.
function diagonalWallJoin(vertexX, vertexY, face) {
  return {
    x: vertexX - Number(face === 1 || face === 2),
    y: vertexY - Number(face === 0 || face === 1),
    type: 1,
    face,
  };
}

module.exports = { diagonalWallFace, diagonalWallJoin };
