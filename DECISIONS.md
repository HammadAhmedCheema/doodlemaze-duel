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
