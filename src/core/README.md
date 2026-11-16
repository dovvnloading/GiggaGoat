# Gigga-Goat — core game loop

Run `npm run dev` and open the Vite root URL. The island now opens behind a **title menu**. Choose **Play** for free roam, **Party** to start a bot round, or **Settings** to tune controls/graphics. The first playable physics, style/GIGGA, tongue, climbing, Hay-Build, chaos props, water and rescues remain in `Game.ts`.

## Free roam and Goat Gigs

Eight bright yellow **E · GIGS** boards mark the island POIs. Walk within 9 metres of a board (same height) and press **E** (gamepad **X**) to inspect the currently posted contracts; offers refresh every three minutes of free-roam simulation. Choose an offer with mouse/keyboard/gamepad. The director only accepts the real posted offer ID after the in-world proximity check, not developer practice runs.

The HUD gives the active contract, next objective, progress, time left, and live medal **pace** (skill conditions still determine the final medal). Gold rings, floating direction arrows and signs mark contract checkpoints, targets and destinations. Temporary parcels, gnomes, towers and crates are spawned as real dynamic Rapier bodies and removed after the attempt; permanent island props remain untouched. A new **G** key (or gamepad **X** during a grazing gig) makes a ground-level grazing bite for Mow-down. Other contracts use existing physical lick, headbutt, climb, flop, bleat, water-splash and prop-moving verbs.

`GigSession` steps `GigDirector` exactly once after every completed Rapier tick in free roam. It samples the actual goat position/scale/grounding, a subset of relevant island and temporary prop bodies (including velocity, tilt, tether ownership and measured contact impulse), real executed ability edges, gameplay-awarded style events and measured upward climb progress. `GigGameplayBridge.settle()` pays pending awards into `GameSimulation.wallet` and acknowledges exactly once. Results show rating, coins, time and the personal best for that gig/difficulty. Press **Esc** for pause/abandon or return to free roam.

## Party rounds

Choose **Rising Tide**, **King of the Peak**, or **Hay Heist**, 3–7 bots and **Easy / Normal / Hard** from the title **Party** menu, or use **P** during free roam. Party matches have countdown, rules, overtime and results from `src/modes`. `PartySession` creates each opponent as a real seven-body, six-joint `GoatRagdoll` in the same `PhysicsWorld`. A seedable `BotBrain` chooses game inputs once per fixed physics tick; `Game.driveGoat()` drives bot and human intents through the same gameplay abilities, movement controller, motor and interaction path. The core reports real torso/head positions and physical contact events to `PartyMatch.step()`. It does not replace physical opponents with animated proxies.

Rising Tide's scheduled levels set both `WaterSystem.setSeaLevel` and `WorldScene.setTideLevel`; the HUD displays the waterline, survivors, time and warning before each rise. King of the Peak shows the scoring goal and capture status. Hay Heist shows two-team scores, simulated bales and carrier status; bales are rendered at the authoritative match positions. Placements appear after a finished round. Returning to free roam disposes bot ragdolls, restores the original sea level and restores the human goat to its pre-party position.

## Menu controls and settings

- **Keyboard/mouse:** WASD / arrows move; Shift sprint; Space jump or flip; hold LMB charged headbutt; hold RMB tongue; R reel; F fling; E bleat or open a nearby gig board; G graze; Q flop; B Hay-Build; 1–4 pieces; P party; Esc pause/back; F3 debug. Move the mouse to look; click the game view to reacquire pointer lock.
- **Gamepad:** left stick move, right stick camera, A jump; RB sprint; RT headbutt (place in build mode); LT/LB tongue; X bleat / nearby board / graze; B flop; Y toggle build; stick clicks fling/reel; D-pad picks build pieces. In menus: D-pad/left stick focus, A select, B back and Start pause/back. Native keyboard Tab, Enter and arrow controls work on every menu.
- **Settings:** mouse sensitivity, invert camera Y, FOV and low/medium/high graphics (shadows/pixel ratio) apply immediately. Volume is a saved preference reserved for the audio lane; core does not import or wire audio.
- **Menus:** title screen Play / Party / Settings; pause Resume / Settings / Party (free roam) / Quit to Title; gig board offers; gig results; round placements with Return to Free Roam. Menus stop simulation ticks without freezing the island render.

## Persistence and boundaries

`Persistence.ts` serializes versioned **gameplay** and **gig director** snapshots with temporary gig-body transforms plus settings into one `localStorage` record (`gigga-goat/save/v1`). It saves every 10 seconds of simulation, on gig payout/menus and page hide. Invalid versions, damaged JSON, missing storage and blocked storage all fall back safely to defaults; no cookies or server accounts. Wallet, unlocks, gig bests and cosmetics restore through the public lane serializers. A pending award is settled exactly once on restore. Multiplayer authority and audio are intentionally outside core scope.

`Game` is still headless (no Three, DOM, storage or browser global). `GameView`, `GameInput`, `GameHud`, `GameMenu` and `boot.ts` own the browser shell. Physics and gameplay retain the shared fixed 1/60-second clock; do not advance modes/gigs per render frame. The only imports from other lanes use their public indexes. `npm run ci` typechecks, runs all Vitest suites (including `game-loop.test.ts`) and builds the Vite bundle. Boundary caveats and workarounds are in `LANE_ISSUES.md`.
