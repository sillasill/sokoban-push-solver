# Sokoban Solver

A push-optimal Sokoban solver for make.fun's `sokoban-solver-01-run-20261121` bounty. It answers all 5 instances of a set in one run, writing `/output/<id>/solution.txt` for each.

## How it works

The generator builds every level as a hallway with one to four independent rooms off it (3–4 boxes each, at most 6×6), and a box pushed out of a room can never be pushed back — so each room is solved on its own, push-optimally, and the room solutions are stitched together with walks along the hallway.

1. **Decompose.** The hallway row (the player's row) is cut out of the floor; each remaining connected component holding boxes is a room, entered through its one square touching the hallway.
2. **Solve each room with A\* over pushes.** A state is the boxes' squares plus the player's reachable region (named by its lowest square). The heuristic is the cheapest assignment of each box to a distinct goal by minimum push distance — a reverse BFS from each goal, ignoring the other boxes — so it never overestimates and the first goal state popped is push-optimal. States are pruned when a box sits on a dead square (no push path to any goal) or inside a frozen 2×2 block of walls and boxes; both prunings only remove states that can never be solved.
3. **Stitch.** The player walks from room to room along the hallway (BFS, boxes as obstacles) and each room's moves are appended.
4. **Fallbacks.** If a room's A\* exhausts its fixed expansion budget (60,000), the same search is retried as plain BFS over pushes (250,000 states). If a level does not decompose into rooms at all, a whole-level A\* with a sum-of-min-distances heuristic is tried instead.

Determinism: every budget is a fixed count of expanded states, every tie is broken by a fixed order, and nothing reads the clock or any random source — two runs write byte-identical output. Node 22, standard library only, no network.

## Practice results

Practice set, kit scorer (`program/scorer/score.ts`): **score 1,000,000** — every instance solved in exactly P\* pushes.

| instance | boxes | rooms | P\* | pushes | points |
|----------|-------|-------|-----|--------|--------|
| i001 | 3 | 1 | 13 | 13 | 1,000 |
| i002 | 4 | 1 | 16 | 16 | 1,000 |
| i003 | 8 | 2 | 29 | 29 | 1,000 |
| i004 | 12 | 3 | 47 | 47 | 1,000 |
| i005 | 16 | 4 | 60 | 60 | 1,000 |

House baseline `plain-astar 1.0.0` on the same practice set: **200,000** (solves only i001; gives up on the other four).

Extra validation: 10 additional sets drawn with the kit generator (different seeds), 50 instances in total — all solved push-optimally, score 1,000,000 on every set. Runtime per set 0.2–0.4 s (limit 60 s), peak memory ~99 MB (limit 512 MB), A\* expansions per room 14–82 (budget 60,000). Two runs on the practice set and on an extra set produce byte-identical outputs.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir with i001..i005/level.txt> MAKEFUN_OUTPUT_DIR=<dir> node main.ts
```
