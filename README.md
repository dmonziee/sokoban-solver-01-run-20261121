# Sokoban Solver — make.fun `sokoban-solver-01-run-20261121`

A push-optimal Sokoban solver for the make.fun bounty
[Build the best Sokoban solver, 21 November 2026](https://make.fun/bounty/sokoban-solver-01-run-20261121).

## Idea

Every level the bounty draws is a hallway with independent rooms off it: a
box pushed out of its room can never come back, so every box stays in its
room and the level's push-optimal count is the sum of its rooms' optima.
The solver therefore

1. splits each level into rooms (the hallway is the row the player starts
   in; every other floor component holding boxes is one room),
2. solves every room on its own with a push-optimal A\* search over
   pushes — minimum-cost box-to-goal matching as the heuristic, plus
   corner, 2×2-block and wall-run deadlock pruning — and
3. walks the player between the rooms' doors along the hallway and writes
   the joined move string.

## Results

- Practice set: **1,000,000 / 1,000,000** — all five levels solved in
  exactly their push-optimal counts (13, 16, 29, 47 and 60 pushes), in
  under a second for the whole set.
- Six further sets drawn from the same generator with fresh random seeds:
  **1,000,000 on every one**, each under a second.
- The house baseline, plain-astar 1.0.0, scores 200,000 on the practice
  set (it only solves the first level).

The program is deterministic: the search is capped by a count of
expansions, never by the clock, so two runs write the same bytes.

## Run

`node main.ts` reads `/input/<id>/level.txt` and writes
`/output/<id>/solution.txt` for `i001`–`i005`
(`MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` stand in for those paths
outside the sandbox). Node 22, standard library only, no dependencies.
