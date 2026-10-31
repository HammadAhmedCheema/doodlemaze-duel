# Graph Report - doodlemaze-duel  (2026-10-31)

## Corpus Check
- 41 files · ~26,419 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 1 file(s) not represented in the graph (top: .css 1)

## Summary
- 376 nodes · 1065 edges · 9 communities (8 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- constants.ts
- theme.ts
- main.ts
- rooms.ts
- scene.ts
- DrawBoard
- Race
- sim.ts
- server/index.ts

## God Nodes (most connected - your core abstractions)
1. `DrawBoard` - 33 edges
2. `Pt` - 27 edges
3. `drawScreen()` - 24 edges
4. `h()` - 21 edges
5. `onMessage()` - 19 edges
6. `Race` - 18 edges
7. `MazeScene` - 16 edges
8. `validateSegments()` - 16 edges
9. `Seg` - 15 edges
10. `defaultTheme()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `DrawBoard` --references--> `ValidationResult`  [EXTRACTED]
  doodlemaze-duel/client/src/draw.ts → doodlemaze-duel/shared/geometry/validate.ts
- `DrawBoard` --references--> `Pt`  [EXTRACTED]
  doodlemaze-duel/client/src/draw.ts → doodlemaze-duel/shared/types.ts
- `DrawBoard` --references--> `Stroke`  [EXTRACTED]
  doodlemaze-duel/client/src/draw.ts → doodlemaze-duel/shared/types.ts
- `drawScreen()` --calls--> `DrawBoard`  [EXTRACTED]
  doodlemaze-duel/client/src/main.ts → doodlemaze-duel/client/src/draw.ts
- `Race` --references--> `Beast`  [EXTRACTED]
  doodlemaze-duel/client/src/race.ts → doodlemaze-duel/client/src/game/beast.ts

## Import Cycles
- None detected.

## Communities (9 total, 1 thin omitted)

### Community 0 - "constants.ts"
Cohesion: 0.07
Nodes (66): DrawBoardOpts, Snapshot, Tool, Beast, BEAST_CATCH, BEAST_SPEED, pickLair(), Input (+58 more)

### Community 1 - "theme.ts"
Cohesion: 0.07
Nodes (38): cfg, t0, v, ThemeRequest, callOpenRouter(), Cfg, extractJson(), hex (+30 more)

### Community 2 - "main.ts"
Cohesion: 0.11
Nodes (43): app, beastSwitch(), buildLabel(), clearSession(), confirmLeave(), drawScreen(), ensureNet(), flash() (+35 more)

### Community 3 - "rooms.ts"
Cohesion: 0.11
Nodes (40): applyTheme(), broadcastState(), canCallVlm(), checkMaze(), Conn, finishRace(), handleConnection(), maybeStartRace() (+32 more)

### Community 4 - "scene.ts"
Cohesion: 0.11
Nodes (25): bricks(), canvas(), Ctx, floorMaterial(), makeTexture(), noise(), shade(), wallMaterial() (+17 more)

### Community 6 - "Race"
Cohesion: 0.11
Nodes (3): Controls, Physics, Race

### Community 7 - "sim.ts"
Cohesion: 0.12
Nodes (9): Handler, Net, assert(), Client, main(), sleep(), MAX_SPEED_UNITS_S, ClientMsg (+1 more)

### Community 8 - "server/index.ts"
Cohesion: 0.10
Nodes (12): configured, models, app, clientDir, __dirname, PORT, server, wss (+4 more)

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pt` connect `constants.ts` to `theme.ts`, `rooms.ts`, `scene.ts`, `DrawBoard`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `drawScreen()` (e.g. with `.applyProposal()` and `.destroy()`) actually correct?**
  _`drawScreen()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Should `constants.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06788766788766788 - nodes in this community are weakly interconnected._
- **Why does `DrawBoard` connect `DrawBoard` to `constants.ts`, `main.ts`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Should `theme.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06693877551020408 - nodes in this community are weakly interconnected._
- **Why does `Race` connect `Race` to `constants.ts`, `main.ts`, `scene.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Should `main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11081560283687943 - nodes in this community are weakly interconnected._