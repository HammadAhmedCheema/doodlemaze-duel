# Decisions

Choices made where the PRD left room, simplest option first.

- **Single package.json** at the root instead of npm workspaces. `client/`, `server/`, `shared/` are folders; Vite bundles `shared/` into the client and `tsx` runs it on the server. Fewer moving parts on hackathon Wi-Fi.
- **`npm start` runs the server through `tsx`** (no separate server compile step). `npm run build` builds the client into `dist/client`, which the server serves.
- **Dijkstra uses Float64 distances internally.** A Float32 distance array caused nodes to be skipped (float rounding made `dist > d[i]` true), found by the sample-maze tests.
- **Reachable mask when solvable** is taken from the goal's distance field (same connected component), so a valid maze needs one Dijkstra, not Dijkstra + flood fill. Keeps validation well under the 50 ms budget.
- **Dead ends** = local maxima of the goal distance field, at least 60 units apart, outside a 25-unit corridor around the shortest path. Props go there, so they never sit on the main route.
- **Gap closing** also snaps endpoints to the outer border (not only to other strokes), so walls drawn "to the edge" connect.
- **Own-stroke snapping** skips the first 42 units of arc length from the endpoint instead of only the adjacent segment, so a freshly drawn wiggle does not snap to itself.
- **Wall boxes are extended by half a thickness at each end**, approximating the round caps drawn on the canvas so corners close in 3D.
- **The player light sits slightly behind and above the eye.** At the eye it blew out walls right next to the camera.
- **Rematch** can be pressed by either player and sends the room straight back to BUILD.
- **A player who leaves or stays disconnected past the 20 s grace forfeits**; during LOBBY the grace is 3 s.
- **Solo practice can also use the AI referee**: a `submit_maze` from a connection that is not in a room is validated and themed (rate limited per connection) but never raced against anyone.
- **Finish time** is the client's elapsed time, capped at the server's own elapsed time + 500 ms, then checked against the speed sanity limit.
- **Lobby share link** uses the server's LAN IP when the host opened `localhost`, so the QR code works from the second device.
- **The 50 ms validation budget** is checked as best-of-4 runs; `PERF_BUDGET_MS` can relax it on slow CI boxes.
- **Extra dependencies:** none beyond the PRD list.
- **README credits "an AI coding assistant (Claude Code)"** rather than Codex, because that is what was actually used.
- **Proxy-free fetch**: the server uses Node's built-in `fetch`. OpenRouter must be reachable from the machine running `npm start`.
- **`npm run vlm:test`** was added (one real call on a sample maze) so the team can confirm the key and model before the demo without playing a full round.
- **Debug cheat:** with `?debug=1`, pressing T in a race jumps next to the goal. Used for automated screenshots; the server's speed check still applies, so it cannot win a real match early.
- **Build timer uses the server clock lazily**: `room_state` can arrive before the first pong, so the end time is stored in server time and converted on every tick; the first ping is sent before any queued message.
- **AI assist never bypasses validation.** "Maze from a photo" and "AI clean-up" ask the VLM for wall segments (strict JSON schema), but the result is loaded into the editor as ordinary strokes: sanitize + validate still decide, and Undo restores the previous drawing.
- **Built-in fallbacks for AI assist:** the photo tracer (Otsu threshold, then long horizontal/vertical dark runs become walls; green/red blobs become Start/Goal) and a straightener (axis snapping + 10-unit grid). Used automatically in mock mode or when the model fails.
- **Photos are auto-cropped** to the bounding box of dark pixels and fitted into the square before tracing or sending to the model.
- **Auto Start/Goal** for pictures without markers: the two farthest-apart points of the largest open region (two Dijkstra sweeps).
- **Beast:** wakes 4 s after GO, moves at 72 % of player speed, replans every 300 ms on the same dilated grid the player collides with, so it cannot cut through walls. Its lair is the dead end farthest (by walking) from the start, not next to the goal. A catch sends the racer back to the start; there is no other penalty, so the first finisher still wins.
- **Camera views:** V cycles first-person and third-person (boom shortened by a ray cast against the walls so it never clips). The overhead view is only offered in solo practice, because in a duel it would act like the minimap the PRD rules out.
- **Wall extraction uses json_object mode with a compact [x1,y1,x2,y2] format.** With strict json_schema the real Qwen3-VL returned empty wall lists (20-50 output tokens). json_object plus an example answer, one nudge retry when empty, and a 45 s timeout replace it. `npm run vlm:test -- walls` checks it.
- **Minimap added at the user's request** (overrides the PRD's no-minimap rule): bottom-centre, shows walls, your trail and heading, the goal and the beast; M hides it.
- **Soundscape:** a quiet ambient pad plays during every race; with a beast, a low drone opens up and a heartbeat speeds up (50 to 150 bpm) as it gets within ~450 units. All Web Audio, no files.
