# Baa-ardwalk set (art lead, Blender, flat materials)

Replaces the stretched pirate dock planks, medieval fantasy-town stalls, highway-sign signboards,
pirate lattice fence, alpha scaffold "piles", grey Poly Pizza wheel, spring disc and construction-barrier
"bumpers" (island QA BW-2 to BW-9). Matched to painting 09 (docs/art/hifi/09_poi_baaardwalk.png).
Each file is built at its gameplay collider box (glTF X = length, Y = up, Z = depth).

| File | Built at (X x Y x Z m) | For | Colour |
|---|---|---|---|
| boardwalk-pier.glb | 27 x 0.92 x 83 | kind `pier` (boards run along Z and meet continuous flush timber sills at each end) | own |
| pier-rail.glb | 8 x 2.65 x 0.5 | kind `pier-rail` (white balustrade, 1.25 m visible inside a 2.65 m anchor frame) | own |
| timber-pile.glb | 0.92 x 8 x 0.92 | Baa-ardwalk piles (round timber, iron straps; currently kind `scaffold`) | own |
| kiosk.glb | 7.2 x 6.8 x 6.4 | kind `booth` (snack kiosk, front = +Z; walls painted white for FULL-strength descriptor paint) | tint 100% |
| striped-awning.glb | 7.4 x 1.0 x 2.5 | kind `awning` (red/white canopy, high edge at -Z against the wall, scalloped valance) | own |
| signboard.glb | 4.6 x 1.4 x 0.3 | kind `signboard` (cream board, timber frame, orange hoof roundel, both faces) | own |
| ferris-wheel.glb | 29.5 x 29 x 4.6 | kind `ferris-wheel` (white A-frame and rim, warm bulbs, pink ring, 12 candy gondolas, hoof hub) | own |
| trampoline.glb | 7 x 1.1 x 7 | kind `trampoline` (black mat, blue padded rim, legs) | own |
| beach-ball.glb | 2.4 x 2.3 x 2.4 | kind `bumper` (red/blue/yellow/white beach ball) | own |

Triangles: 120 (awning) to 5.1k (wheel, 1 instance). CC0.

## Named kiosk signs (QA pass 2, BW-14)

Five painted variants of the 4.6 x 1.4 x 0.3 m kiosk sign, each with an icon roundel and lettering on both faces
(the back face reads correctly too), cream board, timber frame and a coloured top cap:
`kiosk-sign-icecream.glb` (pink), `kiosk-sign-popcorn.glb` (red), `kiosk-sign-games.glb` (blue),
`kiosk-sign-prizes.glb` (purple), `kiosk-sign-candy.glb` (green). 1.5k-4.2k triangles each (lettering).
Own colours, no tint.

## Themed kiosks (QA pass 3, BW-20 / BW-19)

Five own-colour kiosks, 5.0 x 4.8 x 4.5 m (front = glTF +Z), replacing the tintable `kiosk.glb` shed. The booth
tint multiplies every vertex colour, so stripes and goods are authored per variant (no descriptor tint):
pitched canopy striped paint/white down both slopes with a scalloped valance on the front and sides, open
counter with themed goods, stocked shelves inside, two warm hanging lanterns at the front corners, ball finials.
The eave is at 3.05 m and the ridge at 4.55 m; a kiosk sign (4.6 x 1.4 x 0.3) centred 4.2 m up and 0.3 m in front
of the front wall stands on the canopy front like a billboard.

| File | Paint | Goods |
|---|---|---|
| kiosk-icecream.glb | #f0757c | ice cream cones (pink, mint, cream scoops) |
| kiosk-popcorn.glb | #ffc567 | red/white popcorn tubs |
| kiosk-games.glb | #65c8cc | can pyramid and coloured balls |
| kiosk-prizes.glb | #d78abf | plush toys |
| kiosk-candy.glb | #ff9469 | lollipops and sweet jars |

1.1k-1.4k triangles each. Own colours, no tint.
