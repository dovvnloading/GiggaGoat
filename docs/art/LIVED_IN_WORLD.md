# Lived-in world detail — pass 1 and 2

The supplied depot reference changes the previous flat-colour brief in a deliberate way: preserve
Billy Isle's model silhouettes, palette and gameplay geometry, but show how each place is built,
maintained and used. Detail must read at both goat-camera height and the World Lab wide views.

## Coverage

| District | Visible additions |
| --- | --- |
| Hoofington | Road repairs, grates and inspection lids; localized fallen leaves, straw and twigs; daytime pollinators near flowers |
| Baa-ardwalk | Subtle timber grain over existing plank end joints; shore shell and driftwood clusters |
| Crane Yard | Concrete joints, paired tire marks, oil wear, drains, numbered loading bays; formwork/tie-hole shading on columns, weathered steel |
| Downtown | Paving seams, curbside leaf drifts and small paper scraps, drain covers; differentiated plaster, brick, roof, stone, metal and glazing finishes on identified building materials |
| Mt. Gigga | Small angular scree and pinecone clusters anchored to existing rocks/trees |
| Whispering Pines | Pinecones, twigs and leaf fall around existing woodland anchors; daytime pollinators complement existing nighttime fireflies |
| The Dam | Concrete finish on relevant prop meshes; shoreline stone and forest-floor debris outside water |
| Old Lighthouse | Small shingle/shell/twig clusters outside cliff routes and the keeper's path; pollinators by flowers |

## Constraints

- No generated collider, prop ID, gig, spawn or relic changes. Detail RNG is isolated from world generation.
- Paving detail is projected to existing surface triangles rather than sampled from a different terrain surface.
- Architectural detail preserves the baked colour palette and works on the existing mesh batches. Unknown
  named trim and signs are not repainted. Procedural material shaders are WebGL-only; actual geometry
  and pavement decals also render in software.
- The ground-story layer is at most eight merged district batches, culled beyond a near-camera radius.
  Pollinator wings are instanced by district, inactive at night, in heavy rain, under rising tide and far from camera.
- No added textures, model downloads, physics or gameplay AI. Existing art and renderer budgets still apply.

## Review

PR CI runs the existing full TypeScript/unit/headless Chrome/build checks. The Chrome world profile now
also saves unobscured real-WebGL screenshots of bookmarks 08–15 as the `world-detail-previews` artifact.
These are actual rendered game-world frames, not generated concept images. Use them and World Lab's
free camera to assess readability at gameplay distances; do not infer artistic success or hardware FPS
from test completion alone.
