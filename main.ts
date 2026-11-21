// Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
//
// Strategy: the generator builds every level as a hallway with one to four
// independent rooms off it (each room 3-4 boxes, at most 6x6), and a box
// pushed out of a room can never come back, so each room is solved on its
// own, push-optimally, and the room solutions are stitched together with
// walks along the hallway. A room is solved with A* over pushes: a state is
// the boxes' squares plus the player's reachable region (named by its
// lowest square); the heuristic is the cheapest assignment of each box to
// a distinct goal by minimum push distance (a reverse BFS from each goal,
// ignoring the other boxes); states are pruned when a box sits on a dead
// square (no push path to any goal) or inside a frozen 2x2 block of walls
// and boxes. Both prunings only remove states that can never be solved, so
// the first goal state A* pops is push-optimal. If a room's A* exhausts its
// fixed expansion budget, the same search is retried as a plain BFS over
// pushes (heuristic 0). If the level does not decompose into rooms at all,
// a whole-level A* with a sum-of-min-distances heuristic is tried instead.
//
// Determinism: every budget is a fixed count of expanded states, every
// tie is broken by a fixed order, nothing reads the clock or any random
// source, so two runs write byte-identical output.
//
// Node 22, standard library only. Outside a container MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fixed work budgets (expanded states), never the clock.
const ROOM_ASTAR_EXPANSIONS = 60000;
const ROOM_BFS_EXPANSIONS = 250000;
const WHOLE_LEVEL_EXPANSIONS = 120000;

// The four moves, in a fixed order used everywhere (walk BFS ties included).
const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
] as const;

/** All orderings of 0..n-1, for the assignment heuristic (n <= 4). */
const PERMS: number[][][] = [[], [[0]]];
for (let n = 2; n <= 4; n++) {
  const out: number[][] = [];
  const rec = (used: boolean[], cur: number[]): void => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec(used, cur);
      cur.pop();
      used[i] = false;
    }
  };
  rec(new Array<boolean>(n).fill(false), []);
  PERMS.push(out);
}

type Level = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  return { w, h, wall, goals: goals.sort((a, b) => a - b), boxes: boxes.sort((a, b) => a - b), player };
}

/** The shortest walk from `from` to `to` over floor squares not in `blocked`, in lower-case LURD letters. */
function walkTo(
  w: number,
  size: number,
  blocked: (q: number) => boolean,
  from: number,
  to: number,
): string {
  if (from === to) return '';
  const prev = new Int32Array(size).fill(-1);
  const how = new Array<string>(size);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const dir of DIRS) {
      if (dir.dx === -1 && p % w === 0) continue;
      if (dir.dx === 1 && p % w === w - 1) continue;
      const q = p + dir.dy * w + dir.dx;
      if (q < 0 || q >= size || prev[q] !== -1 || blocked(q)) continue;
      prev[q] = p;
      how[q] = dir.ch;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: target out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

type Room = {
  squares: number[];
  boxes: number[];
  goals: number[];
  door: number;
  entry: number;
};

/**
 * Split a level into rooms by cutting out the hallway row (the player's
 * row): every remaining connected floor component holding boxes is a room,
 * entered through the one square touching the hallway row. Null when the
 * level is not a set of rooms (a box or goal in the hallway, a room with a
 * different count of boxes and goals, a room touching the hallway in more
 * than one square).
 */
function decompose(level: Level): Room[] | null {
  const { w, h, wall, goals, boxes, player } = level;
  const size = w * h;
  const hallRow = Math.floor(player / w);
  const comp = new Int32Array(size).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || Math.floor(s / w) === hallRow || comp[s] >= 0) continue;
    const squares = [s];
    comp[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      const p = squares[i]!;
      for (const dir of DIRS) {
        if (dir.dx === -1 && p % w === 0) continue;
        if (dir.dx === 1 && p % w === w - 1) continue;
        const q = p + dir.dy * w + dir.dx;
        if (q < 0 || q >= size || wall[q] || Math.floor(q / w) === hallRow || comp[q] >= 0) continue;
        comp[q] = rooms.length;
        squares.push(q);
      }
    }
    rooms.push({ squares, boxes: [], goals: [], door: -1, entry: -1 });
  }
  for (const b of boxes) {
    const c = comp[b]!;
    if (c < 0) return null;
    rooms[c]!.boxes.push(b);
  }
  for (const g of goals) {
    const c = comp[g]!;
    if (c < 0) return null;
    rooms[c]!.goals.push(g);
  }
  const out: Room[] = [];
  for (const r of rooms) {
    if (r.boxes.length === 0) {
      if (r.goals.length > 0) return null;
      continue;
    }
    if (r.boxes.length !== r.goals.length) return null;
    const doors = r.squares.filter((s) => Math.abs(Math.floor(s / w) - hallRow) === 1);
    if (doors.length !== 1) return null;
    r.door = doors[0]!;
    r.entry = r.door + (hallRow - Math.floor(r.door / w)) * w;
    if (wall[r.entry]!) return null;
    out.push(r);
  }
  return out;
}

type SearchResult =
  | { status: 'solved'; pushes: number; moves: string; endPlayer: number }
  | { status: 'exhausted' }
  | { status: 'unsolvable' };

/**
 * Push-optimal search over one closed sub-problem: the floor is the squares
 * where `inRoom` is set (everything else counts as wall), the boxes start
 * at `boxes`, the goals are `goals`, the player starts at `player`.
 * `assignment` selects the assignment heuristic (false: sum of each box's
 * nearest-goal push distance, for many-box fallbacks). Returns the optimal
 * move string, or why it gave up.
 */
function searchPushes(
  level: Level,
  inRoom: Uint8Array,
  goals: number[],
  boxes: number[],
  player: number,
  maxExpansions: number,
  heur: 'assign' | 'sum' | 'zero',
): SearchResult {
  const { w, h, wall } = level;
  const size = w * h;
  const ng = goals.length;
  const goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  const isWall = (q: number): boolean => q < 0 || q >= size || wall[q] === 1 || inRoom[q] === 0;

  // Push distances: distG[g][s] is the fewest pushes moving one box alone
  // from s onto goal g (reverse BFS from the goal: a box at s pushed in
  // direction d lands at t = s + d, the player standing at s - d).
  const distG: Int32Array[] = [];
  for (const g of goals) {
    const dist = new Int32Array(size).fill(-1);
    dist[g] = 0;
    const queue = [g];
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi]!;
      for (const dir of DIRS) {
        const d = dir.dy * w + dir.dx;
        const s = t - d;
        const ps = s - d;
        if (isWall(s) || isWall(ps) || dist[s]! >= 0) continue;
        dist[s] = dist[t]! + 1;
        queue.push(s);
      }
    }
    distG.push(dist);
  }
  const minDist = new Int32Array(size);
  for (let s = 0; s < size; s++) {
    let m = -1;
    for (let g = 0; g < ng; g++) {
      const v = distG[g]![s]!;
      if (v >= 0 && (m < 0 || v < m)) m = v;
    }
    minDist[s] = m;
  }
  for (const b of boxes) if (minDist[b]! < 0) return { status: 'unsolvable' };

  const heuristic = (bs: number[]): number => {
    if (heur === 'zero') return 0;
    if (heur === 'sum') {
      let sum = 0;
      for (const b of bs) {
        const v = minDist[b]!;
        if (v < 0) return Infinity;
        sum += v;
      }
      return sum;
    }
    let best = Infinity;
    for (const perm of PERMS[ng]!) {
      let sum = 0;
      for (let i = 0; i < ng; i++) {
        const v = distG[perm[i]!]![bs[i]!]!;
        if (v < 0) {
          sum = Infinity;
          break;
        }
        sum += v;
      }
      if (sum < best) best = sum;
    }
    return best;
  };

  // Flood fill from `from` with `occupied` in the way, over the room's
  // floor; returns the region's lowest square and a membership test.
  // Each factory call owns its own mark array, so the current state's
  // region and a successor's region never clobber each other.
  const makeFlood = (): ((occupied: Uint8Array, from: number) => { low: number; has: (q: number) => boolean }) => {
    const seen = new Int32Array(size);
    const stack = new Int32Array(size);
    let stamp = 0;
    return (occupied: Uint8Array, from: number) => {
      stamp++;
      const mark = stamp;
      let low = from;
      let n = 0;
      stack[n++] = from;
      seen[from] = mark;
      while (n > 0) {
        const p = stack[--n]!;
        if (p < low) low = p;
        for (const dir of DIRS) {
          if (dir.dx === -1 && p % w === 0) continue;
          if (dir.dx === 1 && p % w === w - 1) continue;
          const q = p + dir.dy * w + dir.dx;
          if (q < 0 || q >= size || isWall(q) || occupied[q] === 1 || seen[q] === mark) continue;
          seen[q] = mark;
          stack[n++] = q;
        }
      }
      return { low, has: (q: number): boolean => q >= 0 && q < size && seen[q] === mark };
    };
  };
  const floodHere = makeFlood();
  const floodNext = makeFlood();

  const occupied = new Uint8Array(size);
  const frozenBlock = (t: number): boolean => {
    for (const a of [t, t - 1, t - w, t - w - 1]) {
      if (a < 0 || a + w + 1 >= size || a % w === w - 1) continue;
      const sq = [a, a + 1, a + w, a + w + 1];
      let blocked = true;
      let offGoalBox = false;
      for (const s of sq) {
        const isBox = occupied[s] === 1;
        if (!isWall(s) && !isBox) {
          blocked = false;
          break;
        }
        if (isBox && goalSet[s] === 0) offGoalBox = true;
      }
      if (blocked && offGoalBox) return true;
    }
    return false;
  };

  // A state's key is its region's lowest square and its boxes. Numeric
  // while it fits exactly (at most 5 boxes: size^6 < 2^53), a string after
  // that (the whole-level fallback with many boxes).
  const numKey = boxes.length <= 5;
  const keyOf = (bs: number[], low: number): number | string => {
    if (!numKey) return `${low}:${bs.join(',')}`;
    let k = low;
    for (const b of bs) k = k * size + b;
    return k;
  };
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet[b] === 1);

  // The states, in discovery order: boxes, the player's square after the
  // push that made them, the region's lowest square, and the parent.
  const stBoxes: number[][] = [];
  const stPlayer: number[] = [];
  const stLow: number[] = [];
  const stParent: number[] = [];
  const best = new Map<number | string, number>();

  const startBoxes = boxes.slice().sort((a, b) => a - b);
  for (const b of startBoxes) occupied[b] = 1;
  const startRegion = floodHere(occupied, player);
  for (const b of startBoxes) occupied[b] = 0;
  const startH = heuristic(startBoxes);
  if (startH === Infinity) return { status: 'unsolvable' };
  if (solved(startBoxes)) return { status: 'solved', pushes: 0, moves: '', endPlayer: player };
  const startKey = keyOf(startBoxes, startRegion.low);
  stBoxes.push(startBoxes);
  stPlayer.push(player);
  stLow.push(startRegion.low);
  stParent.push(-1);
  best.set(startKey, 0);

  // Heap of [f, -g, sequence, state], smallest first (deeper first, then
  // earliest, on an f tie) — a fixed order, so the search is deterministic.
  const heap: number[][] = [[startH, 0, 0, 0]];
  let seq = 1;
  const heapLess = (a: number[], b: number[]): boolean =>
    a[0]! < b[0]! || (a[0]! === b[0]! && (a[1]! < b[1]! || (a[1]! === b[1]! && a[2]! < b[2]!)));
  const heapPush = (e: number[]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i]!, heap[p]!)) break;
      const t = heap[i]!;
      heap[i] = heap[p]!;
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): number[] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
        if (!heapLess(heap[c]!, heap[i]!)) break;
        const t = heap[i]!;
        heap[i] = heap[c]!;
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };

  let expansions = 0;
  while (heap.length > 0) {
    const [, negG, , idx] = heapPop();
    const g = -negG!;
    const bs = stBoxes[idx!]!;
    if (best.get(keyOf(bs, stLow[idx!]!)) !== g) continue;
    if (solved(bs)) {
      if (process.env.MAKEFUN_DEBUG) console.error('  search expansions:', expansions, 'states:', stBoxes.length);
      // Rebuild the moves: walk to each push square, then push.
      const path: number[] = [];
      for (let s = idx!; s > 0; s = stParent[s]!) path.push(s);
      path.reverse();
      let moves = '';
      let pl = player;
      let cur = startBoxes;
      for (const s of path) {
        const nb = stBoxes[s]!;
        const from = cur.find((b) => !nb.includes(b))!;
        const to = nb.find((b) => !cur.includes(b))!;
        const d = to - from;
        for (const b of cur) occupied[b] = 1;
        const walk = walkTo(w, size, (q) => isWall(q) || occupied[q] === 1, pl, from - d);
        for (const b of cur) occupied[b] = 0;
        moves += walk;
        moves += d === -w ? 'u' : d === w ? 'd' : d === -1 ? 'l' : 'r';
        pl = from;
        cur = nb;
      }
      return { status: 'solved', pushes: path.length, moves, endPlayer: pl };
    }
    if (++expansions > maxExpansions) return { status: 'exhausted' };
    for (const b of bs) occupied[b] = 1;
    const here = floodHere(occupied, stPlayer[idx!]!);
    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi]!;
      for (const dir of DIRS) {
        const d = dir.dy * w + dir.dx;
        const t = b + d;
        if (!here.has(b - d) || isWall(t) || occupied[t] === 1 || minDist[t]! < 0) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(t);
        let next: number[] | null = null;
        let low = -1;
        let h = Infinity;
        if (!frozen) {
          next = bs.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          h = heuristic(next);
          if (h !== Infinity) low = floodNext(occupied, b).low;
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || h === Infinity) continue;
        const g2 = g + 1;
        const k2 = keyOf(next!, low);
        const prevBest = best.get(k2);
        if (prevBest !== undefined && prevBest <= g2) continue;
        best.set(k2, g2);
        stBoxes.push(next!);
        stPlayer.push(b);
        stLow.push(low);
        stParent.push(idx!);
        heapPush([g2 + h, -g2, seq++, stBoxes.length - 1]);
      }
    }
    for (const b of bs) occupied[b] = 0;
  }
  return { status: 'unsolvable' };
}

/** Solve one level's text, returning the move string ('' when unsolved). */
function solveLevel(text: string): string {
  const level = parseLevel(text);
  const { w, h, wall } = level;
  const size = w * h;
  const rooms = decompose(level);
  if (process.env.MAKEFUN_DEBUG) console.error('rooms:', rooms === null ? 'null' : rooms.map((r) => `${r.boxes.length}b door=${r.door} entry=${r.entry}`).join(' | '));
  if (rooms === null) {
    // No room structure: one search over the whole level.
    const inRoom = new Uint8Array(size);
    for (let i = 0; i < size; i++) if (wall[i] === 0) inRoom[i] = 1;
    const res = searchPushes(level, inRoom, level.goals, level.boxes, level.player, WHOLE_LEVEL_EXPANSIONS, 'sum');
    return res.status === 'solved' ? res.moves : '';
  }
  let moves = '';
  let player = level.player;
  let boxes = level.boxes.slice();
  const occ = new Uint8Array(size);
  for (const room of rooms) {
    for (const b of boxes) occ[b] = 1;
    let walk: string;
    try {
      walk = walkTo(w, size, (q) => wall[q] === 1 || occ[q] === 1, player, room.entry);
    } catch {
      return '';
    }
    for (const b of boxes) occ[b] = 0;
    moves += walk;
    player = room.entry;
    const inRoom = new Uint8Array(size);
    for (const s of room.squares) inRoom[s] = 1;
    inRoom[room.entry] = 1;
    let res = searchPushes(level, inRoom, room.goals, room.boxes, player, ROOM_ASTAR_EXPANSIONS, 'assign');
    if (process.env.MAKEFUN_DEBUG) console.error('  room astar:', res.status, res.status === 'solved' ? res.pushes : '');
    if (res.status === 'exhausted') {
      res = searchPushes(level, inRoom, room.goals, room.boxes, player, ROOM_BFS_EXPANSIONS, 'zero');
      if (process.env.MAKEFUN_DEBUG) console.error('  room bfs:', res.status);
    }
    if (res.status !== 'solved') return '';
    moves += res.moves;
    player = res.endPlayer;
    boxes = boxes.filter((b) => !room.boxes.includes(b)).concat(room.goals);
  }
  return moves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const moves = solveLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
