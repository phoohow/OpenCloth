const SELF_COLLISION_COMMON = /* wgsl */`
struct SelfParams {
  particleCount: u32,
  tableMask: u32,
  itemsPerCell: u32,
  _p0: u32,
  cellSize: f32,
  layerSpacing: f32,
  maxMove: f32,
  _p1: f32,
};

@group(0) @binding(0) var<uniform> selfParams: SelfParams;

fn hashCell(x: i32, y: i32, z: i32) -> u32 {
  let h = (bitcast<u32>(x) * 73856093u) ^ (bitcast<u32>(y) * 19349663u) ^ (bitcast<u32>(z) * 83492791u);
  return h & selfParams.tableMask;
}
`;

export const SELF_COLLISION_GRID_WGSL = /* wgsl */`
${SELF_COLLISION_COMMON}

@group(0) @binding(1) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> slotCount: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> slotItems: array<u32>;

@compute @workgroup_size(256)
fn clearSlots(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x;
  if (slot > selfParams.tableMask) { return; }
  atomicStore(&slotCount[slot], 0u);
}

@compute @workgroup_size(256)
fn fillSlots(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= selfParams.particleCount) { return; }
  let pos = predicted[i].xyz;
  if (!all(pos == pos)) { return; }
  let cell = vec3<i32>(floor(pos / selfParams.cellSize));
  let slot = hashCell(cell.x, cell.y, cell.z);
  let index = atomicAdd(&slotCount[slot], 1u);
  if (index < selfParams.itemsPerCell) {
    slotItems[slot * selfParams.itemsPerCell + index] = i;
  }
}
`;

export const SELF_COLLISION_SOLVE_WGSL = /* wgsl */`
${SELF_COLLISION_COMMON}

@group(0) @binding(1) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> posInvMass: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> thickness: array<f32>;
@group(0) @binding(4) var<storage, read> layers: array<u32>;
@group(0) @binding(5) var<storage, read> slotCount: array<u32>;
@group(0) @binding(6) var<storage, read> slotItems: array<u32>;
@group(0) @binding(7) var<storage, read> stitchTable: array<u32>;
@group(0) @binding(8) var<storage, read_write> push: array<vec4<f32>>;

fn stitched(i: u32, j: u32) -> bool {
  let start = stitchTable[i];
  let end = stitchTable[i + 1u];
  for (var k = start; k < end; k++) {
    if (stitchTable[k] == j) { return true; }
  }
  return false;
}

@compute @workgroup_size(256)
fn project(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= selfParams.particleCount) { return; }

  var sum = vec3<f32>(0.0);
  let wI = posInvMass[i].w;
  let pos = predicted[i].xyz;
  if (wI > 0.0 && all(pos == pos)) {
    let cell = vec3<i32>(floor(pos / selfParams.cellSize));
    let layerI = f32(layers[i]);
    for (var dz = -1; dz <= 1; dz++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let slot = hashCell(cell.x + dx, cell.y + dy, cell.z + dz);
          let count = min(slotCount[slot], selfParams.itemsPerCell);
          let first = slot * selfParams.itemsPerCell;
          for (var k = 0u; k < count; k++) {
            let j = slotItems[first + k];
            if (j == i) { continue; }
            let wJ = posInvMass[j].w;
            let wSum = wI + wJ;
            if (wSum <= 0.0) { continue; }
            let delta = pos - predicted[j].xyz;
            let dist2 = dot(delta, delta);
            let layerGap = abs(layerI - f32(layers[j]));
            let spacing = min(max(thickness[i], thickness[j]) + layerGap * selfParams.layerSpacing,
              selfParams.cellSize);
            if (dist2 >= spacing * spacing) { continue; }
            if (stitched(i, j)) { continue; }
            let dist = sqrt(dist2);
            var normal = vec3<f32>(0.0, 1.0, 0.0);
            if (dist > 1e-8) { normal = delta / dist; }
            sum = sum + normal * ((spacing - dist) * (wI / wSum));
          }
        }
      }
    }
  }
  push[i] = vec4<f32>(sum, 0.0);
}

@compute @workgroup_size(256)
fn applyPush(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= selfParams.particleCount) { return; }
  let sum = push[i].xyz;
  let pushLength = length(sum);
  if (pushLength <= 1e-9) { return; }
  var shift = sum;
  if (pushLength > selfParams.maxMove) { shift = sum * (selfParams.maxMove / pushLength); }
  let moved = predicted[i].xyz + shift;
  if (!all(moved == moved)) { return; }
  predicted[i] = vec4<f32>(moved, 0.0);
}
`;
