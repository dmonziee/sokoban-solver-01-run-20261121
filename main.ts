// Sokoban solver: push-optimal per room, then stitched together.
//
// The levels this bounty draws are built from a hallway with independent
// rooms off it: a box pushed out of its room can never come back, so every
// box stays in its room and the push-optimal count of a level is the sum of
// its rooms' optima. This program therefore splits each level into rooms,
// solves every room on its own with a push-optimal A* search, walks the
// player between the rooms' doors along the hallway, and writes the joined
// move string. Everything is deterministic: the search is capped by a count
// of expansions, never by the clock, so two runs write the same bytes.
//
// Usage: node main.ts, reading /input/<id>/level.txt and writing
// /output/<id>/solution.txt for i001..i005 (MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for those paths outside the sandbox).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const INSTANCES = ['i001', 'i002', 'i003', 'i004', 'i005'];

// Directions: 0 up, 1 down, 2 left, 3 right.
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const LETTER = ['u', 'd', 'l', 'r'];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goal: Uint8Array;
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goal = new Uint8Array(w * h);
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goal, boxes, player };
}

// Breadth-first walk over open cells, with a set of blocked cells, from
// `from` to `to`. Returns the move string, or null when unreachable.
function walkPath(
  w: number,
  wall: Uint8Array,
  blocked: Set<number>,
  from: number,
  to: number,
): string | null {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-2);
  const prevDir = new Int8Array(wall.length).fill(-1);
  prev[from] = -1;
  const queue: number[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= Math.floor(wall.length / w)) continue;
      const ni = ny * w + nx;
      if (wall[ni] || blocked.has(ni) || prev[ni] !== -2) continue;
      prev[ni] = cur;
      prevDir[ni] = d;
      if (ni === to) {
        let out = '';
        let at = ni;
        while (at !== from) {
          out = LETTER[prevDir[at]] + out;
          at = prev[at];
        }
        return out;
      }
      queue.push(ni);
    }
  }
  return null;
}

// All cells the player can reach from `from` without pushing, as a set.
function reachable(
  w: number,
  wall: Uint8Array,
  blocked: Set<number>,
  from: number,
): Set<number> {
  const seen = new Set<number>([from]);
  const queue: number[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= Math.floor(wall.length / w)) continue;
      const ni = ny * w + nx;
      if (wall[ni] || blocked.has(ni) || seen.has(ni)) continue;
      seen.add(ni);
      queue.push(ni);
    }
  }
  return seen;
}

interface Room {
  cells: number[]; // local floor cells (room + door cells), global indices
  boxes: number[]; // global indices of this room's boxes, sorted
  goals: number[]; // global indices of this room's goals
  doors: number[]; // global indices of hallway cells opening into the room
}

// Split a level into its rooms: the hallway is the row the player starts
// in; every other floor component holding boxes is one room.
function splitRooms(level: Level): Room[] {
  const { w, h, wall, goal, boxes, player } = level;
  const hallRow = Math.floor(player / w);
  const seen = new Uint8Array(w * h);
  const rooms: Room[] = [];
  for (let start = 0; start < w * h; start++) {
    if (wall[start] || Math.floor(start / w) === hallRow || seen[start]) continue;
    const comp: number[] = [];
    const queue: number[] = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      comp.push(cur);
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (wall[ni] || ny === hallRow || seen[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    const compSet = new Set(comp);
    const roomBoxes = boxes.filter((b) => compSet.has(b));
    if (roomBoxes.length === 0) continue;
    const roomGoals = comp.filter((c) => goal[c]);
    const doors: number[] = [];
    for (const c of comp) {
      const cx = c % w;
      const cy = Math.floor(c / w);
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (ny !== hallRow || nx < 0 || nx >= w) continue;
        const ni = ny * w + nx;
        if (!wall[ni] && !doors.includes(ni)) doors.push(ni);
      }
    }
    rooms.push({ cells: comp, boxes: roomBoxes, goals: roomGoals, doors });
  }
  rooms.sort((a, b) => a.doors[0] - b.doors[0]);
  return rooms;
}

// A push-optimal solver for one room. The player starts on a door cell;
// boxes and goals never leave the room's cells plus its doors.
function solveRoom(level: Level, room: Room, startDoor: number): string | null {
  const { w, wall, goal } = level;
  const local = new Map<number, number>();
  const cells = [...room.cells, ...room.doors];
  cells.forEach((c, i) => local.set(c, i));
  const n = cells.length;
  const isGoal = new Uint8Array(n);
  room.goals.forEach((g) => {
    const li = local.get(g);
    if (li !== undefined) isGoal[li] = 1;
  });
  // Neighbours inside the room, -1 where there is no local cell.
  const nb: number[][] = cells.map((c) => {
    const cx = c % w;
    const cy = Math.floor(c / w);
    const out: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= Math.floor(wall.length / w)) {
        out.push(-1);
        continue;
      }
      const li = local.get(ny * w + nx);
      out.push(li === undefined ? -1 : li);
    }
    return out;
  });
  // All-pairs walk distances inside the room (boxes ignored).
  const dist: number[][] = [];
  for (let s = 0; s < n; s++) {
    const row = new Array<number>(n).fill(Infinity);
    row[s] = 0;
    const q: number[] = [s];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      for (let d = 0; d < 4; d++) {
        const ni = nb[cur][d];
        if (ni < 0 || row[ni] !== Infinity) continue;
        row[ni] = row[cur] + 1;
        q.push(ni);
      }
    }
    dist.push(row);
  }
  const goals = room.goals
    .map((g) => local.get(g))
    .filter((g): g is number => g !== undefined);
  const startBoxes = room.boxes
    .map((b) => local.get(b))
    .filter((b): b is number => b !== undefined)
    .sort((a, b) => a - b);
  const startPlayer = local.get(startDoor);
  if (startPlayer === undefined || goals.length < startBoxes.length) return null;

  // Minimum-cost assignment of boxes to goals (bitmask DP): a lower bound
  // on the pushes still needed, since one push moves one box one cell.
  const m = goals.length;
  const heuristic = (boxes: number[]): number => {
    const k = boxes.length;
    const full = 1 << m;
    const dp = new Array<number>(full).fill(Infinity);
    dp[0] = 0;
    for (let mask = 0; mask < full; mask++) {
      const i = popcount(mask);
      if (i >= k || dp[mask] === Infinity) continue;
      for (let g = 0; g < m; g++) {
        if (mask & (1 << g)) continue;
        const d = dist[boxes[i]][goals[g]];
        if (d === Infinity) continue;
        const nm = mask | (1 << g);
        const v = dp[mask] + d;
        if (v < dp[nm]) dp[nm] = v;
      }
    }
    let best = Infinity;
    for (let mask = 0; mask < full; mask++) {
      if (popcount(mask) === k && dp[mask] < best) best = dp[mask];
    }
    return best;
  };

  // Deadlock: a box that can never reach a goal again.
  const deadlocked = (boxes: number[]): boolean => {
    const set = new Set(boxes);
    for (const b of boxes) {
      if (isGoal[b]) continue;
      // Corner: walls on two perpendicular sides.
      const up = nb[b][0] < 0;
      const down = nb[b][1] < 0;
      const left = nb[b][2] < 0;
      const right = nb[b][3] < 0;
      if ((up || down) && (left || right)) return true;
      // 2x2 block of walls and boxes holding a box off a goal.
      for (let d = 0; d < 4; d++) {
        const a = nb[b][d];
        if (a < 0) continue;
        const side = d < 2 ? 2 : 0;
        const b2 = nb[b][side];
        const a2 = nb[a][side];
        const block = [b, a, b2, a2];
        if (block.every((c) => c < 0 || set.has(c))) {
          if (block.some((c) => c >= 0 && set.has(c) && !isGoal[c])) return true;
        }
      }
      // Against a wall with no goal anywhere along that wall's run, and
      // the run closed by walls at both ends: the box can only slide along
      // the run, never onto a goal. A run whose wall ends is escapable --
      // the box can be pushed past the end and off the wall -- so it is
      // only dead when both ends are shut by a wall.
      const wallSide: [number, number, number][] = [];
      if (up) wallSide.push([0, 2, 3]);
      if (down) wallSide.push([1, 2, 3]);
      if (left) wallSide.push([2, 0, 1]);
      if (right) wallSide.push([3, 0, 1]);
      for (const [side, d1, d2] of wallSide) {
        let hasGoal = false;
        let closed = true;
        for (const d of [d1, d2]) {
          let at = b;
          for (;;) {
            if (isGoal[at]) hasGoal = true;
            const next = nb[at][d];
            if (next < 0) break; // a wall shuts this end
            if (nb[next][side] < 0) {
              at = next; // still against the wall, keep walking the run
              continue;
            }
            closed = false; // the wall ends: the box can leave the run
            break;
          }
        }
        if (closed && !hasGoal) return true;
      }
    }
    return false;
  };

  const keyOf = (boxes: number[], player: number): string =>
    boxes.join(',') + '|' + player;

  // Canonical player position: the lowest cell of its reachable region.
  // Any cell of the region reaches the same pushes, so this collapses the
  // state space without changing what is reachable.
  const canon = (boxes: number[], player: number): number => {
    const blocked = new Set(boxes);
    const seen = new Set<number>([player]);
    const q: number[] = [player];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      for (let d = 0; d < 4; d++) {
        const ni = nb[cur][d];
        if (ni < 0 || blocked.has(ni) || seen.has(ni)) continue;
        seen.add(ni);
        q.push(ni);
      }
    }
    let best = Infinity;
    for (const c of seen) if (c < best) best = c;
    return best;
  };

  // Walk inside the room from `from` to `to` with boxes as obstacles.
  const roomWalk = (boxes: number[], from: number, to: number): string | null => {
    if (from === to) return '';
    const blocked = new Set(boxes);
    const prev = new Int32Array(n).fill(-2);
    const prevDir = new Int8Array(n).fill(-1);
    prev[from] = -1;
    const q: number[] = [from];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      for (let d = 0; d < 4; d++) {
        const ni = nb[cur][d];
        if (ni < 0 || blocked.has(ni) || prev[ni] !== -2) continue;
        prev[ni] = cur;
        prevDir[ni] = d;
        if (ni === to) {
          let out = '';
          let at = ni;
          while (at !== from) {
            out = LETTER[prevDir[at]] + out;
            at = prev[at];
          }
          return out;
        }
        q.push(ni);
      }
    }
    return null;
  };

  // The heap entry keeps two player cells: `player`, the canonical cell
  // of its reachable region (what the state is keyed by), and `actual`,
  // where the player really stands on the path recorded for this state.
  // Both lie in the same region, so the same pushes are reachable from
  // either -- but the recorded walk must start from `actual`, the cell
  // the replay really reaches, not from the canonical one.
  interface HeapEntry {
    f: number;
    g: number;
    boxes: number[];
    player: number;
    actual: number;
  }
  const heap: HeapEntry[] = [];
  const heapPush = (e: HeapEntry): void => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const heapPop = (): HeapEntry => {
    const top = heap[0];
    const last = heap.pop() as HeapEntry;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l].f < heap[s].f) s = l;
        if (r < heap.length && heap[r].f < heap[s].f) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };

  const startCanon = canon(startBoxes, startPlayer);
  const startKey = keyOf(startBoxes, startCanon);
  const best = new Map<string, number>([[startKey, 0]]);
  const came = new Map<string, { prev: string; moves: string }>();
  heapPush({ f: heuristic(startBoxes), g: 0, boxes: startBoxes, player: startCanon, actual: startPlayer });
  let expansions = 0;
  const EXPANSION_CAP = 4000000;
  while (heap.length > 0) {
    const cur = heapPop();
    const curKey = keyOf(cur.boxes, cur.player);
    if ((best.get(curKey) ?? Infinity) < cur.g) continue;
    if (cur.boxes.every((b) => isGoal[b])) {
      let out = '';
      let k = curKey;
      const chain: string[] = [];
      while (came.has(k)) {
        const step = came.get(k) as { prev: string; moves: string };
        chain.push(step.moves);
        k = step.prev;
      }
      chain.reverse();
      for (const s of chain) out += s;
      return out;
    }
    if (++expansions > EXPANSION_CAP) return null;
    // Reachable region from the canonical player cell.
    const blocked = new Set(cur.boxes);
    const region = new Set<number>([cur.player]);
    const rq: number[] = [cur.player];
    for (let head = 0; head < rq.length; head++) {
      const c = rq[head];
      for (let d = 0; d < 4; d++) {
        const ni = nb[c][d];
        if (ni < 0 || blocked.has(ni) || region.has(ni)) continue;
        region.add(ni);
        rq.push(ni);
      }
    }
    for (let bi = 0; bi < cur.boxes.length; bi++) {
      const b = cur.boxes[bi];
      for (let d = 0; d < 4; d++) {
        const beyond = nb[b][d];
        if (beyond < 0 || blocked.has(beyond)) continue;
        const behind = nb[b][d ^ 1];
        if (behind < 0 || !region.has(behind)) continue;
        const nextBoxes = [...cur.boxes];
        nextBoxes[bi] = beyond;
        nextBoxes.sort((a, z) => a - z);
        if (deadlocked(nextBoxes)) continue;
        const walk = roomWalk(cur.boxes, cur.actual, behind);
        if (walk === null) continue;
        const nextPlayer = canon(nextBoxes, b);
        const ng = cur.g + 1;
        const nk = keyOf(nextBoxes, nextPlayer);
        if ((best.get(nk) ?? Infinity) <= ng) continue;
        best.set(nk, ng);
        came.set(nk, { prev: curKey, moves: walk + LETTER[d] });
        const h = heuristic(nextBoxes);
        if (h === Infinity) continue;
        heapPush({ f: ng + h, g: ng, boxes: nextBoxes, player: nextPlayer, actual: b });
      }
    }
  }
  return null;
}

function popcount(x: number): number {
  let c = 0;
  while (x > 0) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}

// Apply a move string to a level state; false when a move is illegal.
function applyMoves(level: Level, boxes: Set<number>, player: number, moves: string): { boxes: Set<number>; player: number } | null {
  const { w, wall } = level;
  const b = new Set(boxes);
  let p = player;
  for (const ch of moves) {
    const d = LETTER.indexOf(ch);
    if (d < 0) return null;
    const nx = (p % w) + DX[d];
    const ny = Math.floor(p / w) + DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= Math.floor(wall.length / w)) return null;
    const ni = ny * w + nx;
    if (wall[ni]) return null;
    if (b.has(ni)) {
      const bx = nx + DX[d];
      const by = ny + DY[d];
      if (bx < 0 || by < 0 || bx >= w || by >= Math.floor(wall.length / w)) return null;
      const bi = by * w + bx;
      if (wall[bi] || b.has(bi)) return null;
      b.delete(ni);
      b.add(bi);
    }
    p = ni;
  }
  return { boxes: b, player: p };
}

function solveLevel(level: Level): string {
  const rooms = splitRooms(level);
  if (rooms.length === 0) return '';
  let boxes = new Set(level.boxes);
  let player = level.player;
  let out = '';
  for (const room of rooms) {
    const door = room.doors[0];
    const walk = walkPath(level.w, level.wall, boxes, player, door);
    if (walk === null) return '';
    const stepped = applyMoves(level, boxes, player, walk);
    if (stepped === null) return '';
    boxes = stepped.boxes;
    player = stepped.player;
    out += walk;
    const roomMoves = solveRoom(level, room, door);
    if (roomMoves === null) return '';
    const after = applyMoves(level, boxes, player, roomMoves);
    if (after === null) return '';
    boxes = after.boxes;
    player = after.player;
    out += roomMoves;
  }
  // Verify the joined solution really solves the level.
  for (const b of boxes) if (!level.goal[b]) return '';
  return out;
}

function main(): void {
  for (const id of INSTANCES) {
    let solution = '';
    try {
      const text = readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8');
      solution = solveLevel(parseLevel(text));
    } catch {
      solution = '';
    }
    const dir = join(OUTPUT_DIR, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'solution.txt'), solution + '\n', 'utf8');
  }
}

main();
