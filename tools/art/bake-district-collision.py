"""Rebuild the small district scenery collision meshes from the shipped glTF kits.

Run from the repo root with Python, trimesh, numpy, scipy and fast-simplification.
The output uses the same bottom-centre origin and uniform scale as the renderer.
"""
import json
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree


def bake(model):
    scene = trimesh.load_scene(model)
    components = []
    colours = []
    for node in scene.graph.nodes_geometry:
        transform, key = scene.graph[node]
        part = scene.geometry[key].copy()
        part.apply_transform(transform)
        visual = part.visual
        if visual.kind == "texture":
            material = visual.material
            image = material.baseColorTexture
            if image is not None and visual.uv is not None:
                rgb = trimesh.visual.color.uv_to_color(visual.uv[part.faces].mean(axis=1), image)[:, :3]
            else:
                factor = material.baseColorFactor
                linear = np.ones(3) if factor is None else np.asarray(factor[:3]) / 255
                srgb = np.where(linear < .00313, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - .055)
                rgb = np.tile(np.rint(srgb * 255), (len(part.faces), 1))
        else:
            rgb = visual.face_colors[:, :3]
        colours.append(rgb.astype(int))
        components.append(trimesh.Trimesh(vertices=part.vertices, faces=part.faces, process=False))
    mesh = trimesh.util.concatenate(components)
    low, high = mesh.bounds
    span = high - low
    length = max(span)
    mesh.apply_translation(-np.array([(high[0] + low[0]) / 2, low[1], (high[2] + low[2]) / 2]))
    mesh.apply_scale(1 / length)
    paint_points = cKDTree(mesh.triangles_center)
    normals = mesh.face_normals.copy()
    paint = np.concatenate(colours)
    mesh.merge_vertices(merge_tex=True, merge_norm=True)
    if len(mesh.faces) > 192:
        mesh = mesh.simplify_quadric_decimation(face_count=192, aggression=4)
    mesh.update_faces(mesh.nondegenerate_faces() & mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    # Map simplified triangles back to nearby authored faces facing the same way.
    distances, near = paint_points.query(mesh.triangles_center, k=4)
    score = distances + .04 * (1 - (normals[near] * mesh.face_normals[:, None, :]).sum(axis=2))
    rgb = paint[near[np.arange(len(near)), score.argmin(axis=1)]]
    packed = (rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]
    palette, colours = np.unique(packed, return_inverse=True)
    return {
        "palette": palette.tolist(), "paint": colours.tolist(),
        "span": np.round(span / length, 5).tolist(),
        "vertices": np.rint(mesh.vertices.flatten() * 4096).astype(int).tolist(),
        "indices": mesh.faces.flatten().tolist(),
    }


if __name__ == "__main__":
    root = Path("src/world")
    models = json.loads((root / "district-kit-models.json").read_text())
    hulls = {name: bake(Path("public/assets/library") / path) for name, path in models.items()}
    (root / "district-kit-collision.json").write_text(json.dumps(hulls, separators=(",", ":")) + "\n")
