# First playable — core integration

The root Vite entry (npm run dev, then the root URL) now runs Billy Isle. Core is the only adapter between lanes: no source under physics, world, gameplay or chaos was changed.

## Boundaries and fixed clock

- **Game.ts** is headless and works in Node/Vitest. Game.create({seed?, resolution?}) generates the real island, creates Rapier's PhysicsWorld, calls the world collider adapter, registers moving/breakable props, installs sea/river/reservoir water and physical bounce/launch surfaces, creates the seven-body goat, and owns gameplay rules, size progression, Hay-Build colliders, rescue and contact-to-style scoring. The world, rules, and all physics systems share **one** PhysicsWorld and its fixed 60 Hz timeline.
- Game.advance(seconds, input) calls physics.step(seconds) once; Rapier limits catch-up to five fixed substeps and interpolates between physics poses. Game.step(input) is precisely one fixed tick for tests. onBeforeStep runs gameplay abilities and applies their commands **before** the ragdoll locomotion/motor hook. onAfterStep measures climbing and handles sea rescue; lane contact/surface/water event subscriptions award style through rules.awardStyle. Physics and gameplay are never stepped separately at render frame rate.
- **GameView.ts** is browser-only. It builds the exported createWorldScene, renders each goat body with a separate provisional mesh, keeps dynamic world prop instance transforms and debris in sync with the interpolated Rapier bodies, shows physical Hay-Build objects, places conspicuous pad markers, smooths the collision-avoiding third-person camera, and renders a soft-shaded daylight scene. Nothing in Game imports THREE or DOM objects.
- **GameInput.ts** maps keyboard/mouse/pointer-lock and a standard gamepad into PlayerIntent (gameplay intent plus movement axes and camera yaw). **GameHud.ts** owns the CSS/DOM HUD and F3 debug overlay, with no simulation mutations. **boot.ts** owns startup.
- Physics's **goat** is authoritative for pose; gameplay's **style tier** is authoritative for physical size. Tier changes are queued to the next fixed pre-step, then ragdoll bodies/joints are rebuilt by the physics lane and water/body-mesh tracking is refreshed. Gameplay's scale is eased for camera distance.
- Dynamic island props are registered with metadata, active contact-force events and physical materials. Chaos tracks buoyancy, breakage, fizzy barrels, domino effects and collision-triggered launch/bounce surfaces. Static descriptors explicitly marked breakable get core-side dynamic bodies so the registry can manage them.
- Build uses gameplay's face-connected grid and real inventory. The first piece anchors at local ground level; fixed pieces use physical colliders, ramp wedges are sloped, launch-pad pieces create chaos launch surfaces, and unsupported collapsed pieces become falling Rapier cubes.
- Ocean submersion over 2.5 seconds and leaving island bounds rescue to the Hoofington spawn. The goat can paddle and float.
- Game.dispose() removes physics hooks and frees all simulation resources; GameView.dispose() frees Three resources, event listeners, input and HUD.

## Play

Run npm run dev and open the shown root Vite URL. **Click the canvas** to lock the mouse; Esc unlocks. Look around with the mouse and run with **WASD** relative to the camera; hold **Shift** for a stamina-gated sprint. **Space** jumps; press again in the air to flip. Move against a steep cliff or building face to climb; jump to kick off it. **Hold LMB** to charge a headbutt and release to ram a crate or wall. **Hold RMB** to fire a tongue tether, **R** reels in, **F** flings, and release RMB to detach. **E** bleats with a physical pulse; **Q** flops into full ragdoll. **B** toggles Hay-Build, **1–4** choose floor, wall, ramp and launch pad, **LMB** places. **F3** toggles FPS, physics step duration and body/debris counts. The GIGGA meter grows from varied tricks, not repeated spam.

Standard gamepad: left stick moves, right stick orbits, A jumps/flips, RB sprints, RT charges headbutts (or places in build mode), LT/LB licks, X bleats, B flops, left stick click flings, right stick click reels, Y toggles build, D-pad up/right/down/left selects the four building pieces.

The farm has a purple trampoline and an orange launch pad, and the boardwalk has another orange pad. Launch-pad Hay-Build pieces also have physical launch triggers. The HUD shows stamina, headbutt charge, current tier, score, combo and materials.

## Tests and maintenance

npm run ci runs strict TypeScript typecheck, Vitest (including integration.test.ts) and the production build. The core suite boots the actual deterministic island, advances ten seconds at 60 Hz, verifies an upright above-sea ragdoll, jump, charged headbutt prop displacement, sea rescue, actual size-tier/body rebuild and chaos features. No browser mocks are needed for Game tests.

The boundary issues are in LANE_ISSUES.md. The provisional proxy goat uses chunky cream volume, stubby legs, curled tan horns and an orange scarf as a readable stand-in for the character art phase.
