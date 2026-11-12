// Mechanics: OSRS Wiki Burthorpe Games Room and the official 24 November 2004
// Games Room update (standard English draughts, except the forty-move draw).
// https://oldschool.runescape.wiki/w/Burthorpe_Games_Room
// https://oldschool.runescape.wiki/w/Update:Burthorpe_Games_Room
// The draw counts completed turns without capture/promotion. Current captures do
// not establish how the original server counts multi-jumps; captures reset it.
function create(game) {
  if (game === 'runeversi') return require('./Rule.Runeversi.GamesRoom').create();
  if (game === 'runesquares') return require('./Rule.RuneSquares.GamesRoom').create();
  if (game !== 'draughts' && game !== 'runelink') throw new RangeError('Unknown board game');
  const board = Array(game === 'draughts' ? 64 : 42).fill(0);
  if (game === 'draughts') {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1) board[row * 8 + col] = row < 3 ? -1 : row > 4 ? 1 : 0;
      }
    }
  }
  return { game, board, turn: 0, quietMoves: 0, forced: null, result: null };
}

function capturesFrom(state, from) {
  return movesFrom(state, from, true);
}

function movesFrom(state, from, capture) {
  const piece = state.board[from];
  if (Math.sign(piece) !== (state.turn === 0 ? 1 : -1)) return [];
  const row = Math.floor(from / 8), col = from % 8;
  const directions = Math.abs(piece) === 2 ? [-1, 1] : [piece > 0 ? -1 : 1];
  const distance = capture ? 2 : 1, moves = [];
  for (const direction of directions) {
    for (const horizontal of [-1, 1]) {
      const targetRow = row + direction * distance, targetCol = col + horizontal * distance;
      if (targetRow < 0 || targetRow > 7 || targetCol < 0 || targetCol > 7) continue;
      const to = targetRow * 8 + targetCol;
      if (state.board[to] !== 0) continue;
      if (capture) {
        const jumped = state.board[(row + direction) * 8 + col + horizontal];
        if (!jumped || Math.sign(jumped) === Math.sign(piece)) continue;
      }
      moves.push({ from, to });
    }
  }
  return moves;
}

function legalMoves(state) {
  if (state.game === 'runeversi') return require('./Rule.Runeversi.GamesRoom').legalMoves(state);
  if (state.game === 'runesquares') return require('./Rule.RuneSquares.GamesRoom').legalMoves(state);
  if (state.result) return [];
  if (state.game === 'runelink') {
    return Array.from({ length: 7 }, (_, column) => ({ column })).filter(move => !state.board[move.column]);
  }
  if (state.forced !== null) return capturesFrom(state, state.forced);
  const captures = [], quiet = [];
  for (let from = 0; from < 64; from++) {
    captures.push(...capturesFrom(state, from));
    quiet.push(...movesFrom(state, from, false));
  }
  return captures.length ? captures : quiet;
}

function play(state, side, move) {
  if (state.game === 'runeversi') return require('./Rule.Runeversi.GamesRoom').play(state, side, move);
  if (state.game === 'runesquares') return require('./Rule.RuneSquares.GamesRoom').play(state, side, move);
  if (state.result || side !== state.turn || !move || typeof move !== 'object') return false;
  if (state.game === 'runelink') {
    if (!Number.isInteger(move.column) || !legalMoves(state).some(x => x.column === move.column)) return false;
    return playRuneLink(state, side, move.column);
  }
  if (!Number.isInteger(move.from) || !Number.isInteger(move.to) ||
      !legalMoves(state).some(x => x.from === move.from && x.to === move.to)) return false;
  const piece = state.board[move.from];
  const captured = Math.abs(Math.floor(move.from / 8) - Math.floor(move.to / 8)) === 2;
  state.board[move.from] = 0;
  state.board[move.to] = piece;
  if (captured) state.board[(move.from + move.to) / 2] = 0;
  const promoted = Math.abs(piece) === 1 && (piece > 0 ? move.to < 8 : move.to >= 56);
  if (promoted) state.board[move.to] = piece * 2;
  if (captured || promoted) state.quietMoves = 0;
  if (captured && !promoted && capturesFrom(state, move.to).length) {
    state.forced = move.to;
    return true;
  }
  state.forced = null;
  if (!captured && !promoted) state.quietMoves++;
  state.turn = 1 - side;
  if (!legalMoves(state).length) state.result = { winner: side, reason: 'no-legal-moves' };
  else if (state.quietMoves >= 40) state.result = { winner: null, reason: 'forty-moves' };
  return true;
}

function playRuneLink(state, side, column) {
  let row = 5;
  while (state.board[row * 7 + column]) row--;
  const piece = side === 0 ? 1 : -1;
  state.board[row * 7 + column] = piece;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = column + dc * sign;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && state.board[r * 7 + c] === piece) {
        count++; r += dr * sign; c += dc * sign;
      }
    }
    if (count >= 4) {
      state.result = { winner: side, reason: 'four-in-row' };
      break;
    }
  }
  if (!state.result && state.board.every(Boolean)) state.result = { winner: null, reason: 'board-full' };
  state.turn = 1 - side;
  return true;
}

function chooseAutoMove(state, random = Math.random) {
  const moves = legalMoves(state);
  return moves.length ? moves[Math.floor(random() * moves.length)] : null;
}

function rankChange(winner, loser) {
  return Math.max(1, Math.min(100, Math.floor(50 + (loser - winner) / 16)));
}

module.exports = { create, legalMoves, play, chooseAutoMove, rankChange };
