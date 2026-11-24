# Zombie test (sprite-test)

Top-down zombie prototype on Sara's pixel sprites. Plain HTML + Canvas 2D, no build step.

```bash
./sync-assets.sh                      # re-copy Sara's exports into assets/ after any re-export
python3 -m http.server 8765 --bind 127.0.0.1
```
Open http://127.0.0.1:8765/

Controls: WASD/arrows move (8-dir) · Shift sprint · Left click / J / Space swing (click faces the cursor) ·
1-4 pick weapon, Q/E cycle · B or F1 debug boxes · R reset.

Everything (sheet rows, frame counts, timings, weapon grip/angle/scale/order/flip_v, hit frames, reach boxes,
hurtboxes, collision ellipse) is read by name from the JSON in `assets/` at load time; no row indices are hardcoded.

Verify: `node verify-zombie.mjs` (needs the server running). Screens go to `screens/zombie-*.png`.
