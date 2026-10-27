# Bundled body models

## human-body-f.glb (default)

Based on **GEO-body_female_realistic** from *Human Base Meshes v1.4.1* © Blender Studio and community
contributors, donated to the public domain under
[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). Source:
https://www.blender.org/download/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip
(file used: `human_base_meshes_bundle.blend`).

Modifications: the multires level-1 subdivision (86.9 k triangles) was applied in headless Blender 4.5 and
joined with the two eye meshes; UV layers, vertex colors, materials and the (unused) rig data were dropped
so the export stays a single unsplit vertex buffer; the mesh was rotated to face +Z, scaled to 1.70 m and
grounded at y = 0, and given one matte warm-gray body material plus one dark eye material. The figure's
rest pose already hangs the arms ~28° from vertical, so no re-posing was needed. Measurements in
`BUNDLED_AVATARS` (chest 92 / waist 70 / hip 92) follow the exported mesh's cross-sections.

## human-body-pro.glb

Derived from **Xbot.glb**, the neutral placeholder body shipped in the three.js examples:
https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf (three.js is MIT; the model itself
carries no license statement and is the Mixamo "X-Bot" character, so treat redistribution as unresolved).

Modifications: rig, skinning, animations and UVs removed; the arms were posed from T-pose down to ~30°
from vertical by linear blend skinning on the arm joint subtrees; the mesh was rotated to face +Z,
scaled to 1.70 m and grounded at y = 0; the two original materials were replaced by one matte warm-gray
body material plus one dark eye material.

**Replace this asset before any public distribution** unless an explicit license for the character is
obtained. `human-body.glb` below is a fully licensed alternative and stays selectable in the 模特 list.

## human-body.glb

Based on **Cesium Man** © 2017 Cesium, licensed [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan

Modifications: texture, rig, skinning and animation removed; a single matte gray material replaces the
original one; the root transform is rotated so the body faces +Z. The Cesium logo texture is not shipped
(trademarks are excluded from the CC-BY grant).

Attribution to keep with any build: "Human body model: Cesium Man © 2017 Cesium, CC-BY-4.0."

## Provenance scripts

The one-off conversion scripts live outside the repository (`D:\tmp` and `D:\tmp\opencloth-models`):
`export_hr.py` runs headless Blender 4.5 to subdivide, join and export a body from the base-meshes bundle,
and `render_glb.py` produces Workbench preview PNGs used for visual checking;
`prepare-body.cjs` poses and rewrites a body GLB, and `prepare-body2.cjs` adds the leg-closing step the
older rigged exports needed (it is a no-op at angle 0 for the current female model);
`silhouette.cjs` prints an ASCII silhouette, and `profile2.cjs` measures cross-section girths used for the
bundled 模特 measurements.
