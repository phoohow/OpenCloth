/** WGSL compute shaders of the GPU PBD/XPBD cloth simulation passes. */

// ============ Integration pass ============
export const INTEGRATE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  gravity: vec3<f32>,
  _p0: f32,
  windDir: vec3<f32>,
  windSpeed: f32,
  damping: f32,
  time: f32,
  maxSpeed: f32,
  _p1: f32,
  // Pointer drag: xyz = point the grabbed fabric is pulled toward, w = 1 while dragging.
  grabTarget: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> prevPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: SimParams;
// Per-particle pointer-drag weight, 0 for fabric outside the grabbed region.
@group(0) @binding(5) var<storage, read> grabWeight: array<f32>;

@compute @workgroup_size(256)
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let pos = posInvMass[i];
  let vel = velocity[i];
  let invMass = pos.w;

  // Save the previous frame position, including inverse mass.
  prevPos[i] = pos;

  if (invMass == 0.0) {
    predicted[i] = pos;
    return;
  }

  var accel = params.gravity;
  // Wind force, varying over time.
  let windPhase = sin(params.time * 2.0 + f32(i) * 0.013);
  accel = accel + params.windDir * params.windSpeed * (1.0 + 0.3 * windPhase);

  let dt = params.dt;
  // Predicted position: x_pred = x + v*dt + a*dt^2.
  var pred = pos.xyz + vel.xyz * dt + accel * dt * dt;

  // Pointer drag: the grabbed particles follow the pointer. Each substep covers their weight of
  // the remaining gap, so the pull travels through the constraint network as a force.
  let weight = grabWeight[i];
  if (params.grabTarget.w > 0.0 && weight > 0.0) {
    pred = pred + (params.grabTarget.xyz - pos.xyz) * weight;
  }

  predicted[i] = vec4<f32>(pred, 0.0);
}
`;

// ============ Constraint solve pass (XPBD) ============
export const SOLVE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  constraintCount: u32,
  _p0: f32,
  _p1: vec3<f32>,
  _p2: f32,
};

struct Constraint {
  p0: u32,
  p1: u32,
  restLength: f32,
  compliance: f32,
};

@group(0) @binding(0) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> posInvMass: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> constraints: array<Constraint>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn solve(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ci = gid.x;
  if (ci >= params.constraintCount) { return; }

  let c = constraints[ci];
  let w0 = posInvMass[c.p0].w;
  let w1 = posInvMass[c.p1].w;
  let wSum = w0 + w1;
  if (wSum == 0.0) { return; }

  let p0 = predicted[c.p0].xyz;
  let p1 = predicted[c.p1].xyz;
  let delta = p1 - p0;
  let dist = length(delta);
  if (dist < 1e-7) { return; }

  // XPBD single iteration: lambda starts at 0, alpha = compliance / dt^2.
  let alpha = c.compliance;
  // C = dist - restLength;  Δ = -C / (wSum + alpha)
  let diff = (dist - c.restLength) / (dist * (wSum + alpha));
  let correction = delta * diff;

  // Graph coloring prevents write conflicts within a batch, so direct writes are safe.
  predicted[c.p0] = vec4<f32>(p0 + correction * w0, 0.0);
  predicted[c.p1] = vec4<f32>(p1 - correction * w1, 0.0);
}
`;

// ============ Body collision pass (mesh triangles or capsule fallback) + floor collision ============
export const COLLIDE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  capsuleCount: u32,
  surfaceOffset: f32,
  friction: f32,
  floorY: f32,
  clothThickness: f32,
  triangleCount: u32,
  // Collision grid: xyz = minimum corner, w = cell edge
  gridOrigin: vec4<f32>,
  // Collision grid: xyz = cell counts per axis
  gridDims: vec4<f32>,
};

struct Capsule {
  a: vec4<f32>,   // xyz = start point, w = radius x
  b: vec4<f32>,   // xyz = end point, w = radius z (0 falls back to radius x)
};

struct SurfaceHit {
  point: vec3<f32>,
  distance: f32,
  // +1 when the query point lies outside the surface, -1 inside
  side: f32,
};

@group(0) @binding(0) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> capsules: array<Capsule>;
@group(0) @binding(2) var<uniform> params: SimParams;
@group(0) @binding(3) var<storage, read> prevPos: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> meshTriangles: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> cellStart: array<u32>;
@group(0) @binding(6) var<storage, read> cellTriangles: array<u32>;

fn pointSegmentClosest(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
  let ab = b - a;
  let ap = p - a;
  let abLen2 = dot(ab, ab);
  var t = 0.0;
  if (abLen2 > 0.0) { t = clamp(dot(ap, ab) / abLen2, 0.0, 1.0); }
  return a + ab * t;
}

fn closestOnTriangle(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  let d1 = dot(ab, ap);
  let d2 = dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) { return a; }

  let bp = p - b;
  let d3 = dot(ab, bp);
  let d4 = dot(ac, bp);
  if (d3 >= 0.0 && d4 <= d3) { return b; }

  let vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    return a + ab * (d1 / (d1 - d3));
  }

  let cp = p - c;
  let d5 = dot(ab, cp);
  let d6 = dot(ac, cp);
  if (d6 >= 0.0 && d5 <= d6) { return c; }

  let vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    return a + ac * (d2 / (d2 - d6));
  }

  let va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
    return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
  }

  let denom = 1.0 / (va + vb + vc);
  return a + ab * (vb * denom) + ac * (vc * denom);
}

// Squared distance from p to the nearest point of cell (ix, iy, iz).
fn cellDistance2(p: vec3<f32>, origin: vec3<f32>, ix: i32, iy: i32, iz: i32, cell: f32) -> f32 {
  let lo = origin + vec3<f32>(f32(ix), f32(iy), f32(iz)) * cell;
  let outside = max(max(lo - p, p - (lo + vec3<f32>(cell))), vec3<f32>(0.0));
  return dot(outside, outside);
}

// Nearest body surface point, searched over a (2*rings+1)^3 block of grid cells. Cells farther
// than the best hit so far are skipped, so the walk costs little once a nearby triangle is known.
fn nearestSurface(p: vec3<f32>, rings: i32) -> SurfaceHit {
  let origin = params.gridOrigin.xyz;
  let cell = params.gridOrigin.w;
  let dimsX = i32(params.gridDims.x);
  let dimsY = i32(params.gridDims.y);
  let dimsZ = i32(params.gridDims.z);
  let base = vec3<i32>(floor((p - origin) / cell));

  var hit: SurfaceHit;
  hit.point = p;
  hit.distance = 1e9;
  hit.side = 1.0;

  for (var oz = -rings; oz <= rings; oz++) {
    let iz = base.z + oz;
    if (iz < 0 || iz >= dimsZ) { continue; }
    for (var oy = -rings; oy <= rings; oy++) {
      let iy = base.y + oy;
      if (iy < 0 || iy >= dimsY) { continue; }
      let row = (iz * dimsY + iy) * dimsX;
      for (var ox = -rings; ox <= rings; ox++) {
        let ix = base.x + ox;
        if (ix < 0 || ix >= dimsX) { continue; }
        if (cellDistance2(p, origin, ix, iy, iz, cell) > hit.distance * hit.distance) { continue; }
        let ci = u32(row + ix);
        let end = cellStart[ci + 1u];
        for (var k = cellStart[ci]; k < end; k++) {
          let tri = cellTriangles[k] * 3u;
          let a = meshTriangles[tri].xyz;
          let b = meshTriangles[tri + 1u].xyz;
          let c = meshTriangles[tri + 2u].xyz;
          let q = closestOnTriangle(p, a, b, c);
          let off = p - q;
          let d = length(off);
          if (d < hit.distance) {
            hit.point = q;
            hit.distance = d;
            // Winding decides the side, so a point inside the body is pushed back out.
            hit.side = select(-1.0, 1.0, dot(off, cross(b - a, c - a)) >= 0.0);
          }
        }
      }
    }
  }
  return hit;
}

// Tangential pull toward the sub-step start; the normal component is unchanged.
fn applyFriction(pos: vec3<f32>, n: vec3<f32>, prev: vec3<f32>, amount: f32) -> vec3<f32> {
  let toPrev = prev - pos;
  return pos + (toPrev - dot(toPrev, n) * n) * amount;
}

// Fallback body collision: the capsule approximation used when no mesh collider is present.
fn collideCapsules(posIn: vec3<f32>, clearance: f32) -> vec3<f32> {
  var pos = posIn;
  var minDist = 1e9;
  var bestClosest = vec3<f32>(0.0);
  var bestRadius = 0.0;
  for (var ci = 0u; ci < params.capsuleCount; ci++) {
    let cap = capsules[ci];
    let a = cap.a.xyz;
    let b = cap.b.xyz;
    let rx = cap.a.w;
    let rz = select(rx, cap.b.w, cap.b.w > 0.0);
    let closest = pointSegmentClosest(pos, a, b);
    let off = pos - closest;
    // Capsule cross-sections are ellipses: bodies are wider than they are deep.
    var r = rx;
    if (length(vec2<f32>(off.x, off.z)) > 1e-6 && rz > 0.0) {
      let t = atan2(off.z, off.x);
      let cz = cos(t) * rz;
      let sz = sin(t) * rx;
      r = (rx * rz) / sqrt(cz * cz + sz * sz);
    }
    let d = length(off) - r;
    if (d < minDist) {
      minDist = d;
      bestClosest = closest;
      bestRadius = r;
    }
  }
  if (minDist < clearance) {
    let dir = pos - bestClosest;
    let dirLen = length(dir);
    var n = vec3<f32>(0.0, 1.0, 0.0);
    if (dirLen > 1e-7) { n = dir / dirLen; }
    return bestClosest + n * (bestRadius + clearance);
  }
  return pos;
}

@compute @workgroup_size(256)
fn collide(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  var pos = predicted[i].xyz;
  var moved = false;
  // Cloth thickness adds to the clearance kept against every collision surface.
  let clearance = params.surfaceOffset + params.clothThickness;
  let prev = prevPos[i].xyz;

  if (params.triangleCount > 0u) {
    // The body mesh is the collider: project onto the surface plus the clearance. A point inside
    // the body is pushed out along the nearest triangle normal, however deep the searched block
    // reaches; only points outside are gated by the clearance, which keeps them off the skin.
    var hit = nearestSurface(pos, 1);
    if (hit.distance > 1e8) { hit = nearestSurface(pos, 3); }
    if (hit.side < 0.0 || hit.distance < clearance) {
      let off = pos - hit.point;
      let len = length(off);
      var n = vec3<f32>(0.0, 1.0, 0.0);
      if (len > 1e-6) { n = off / len * hit.side; }
      pos = applyFriction(hit.point + n * clearance, n, prev, params.friction);
      moved = true;
    }
  } else if (params.capsuleCount > 0u) {
    let pushed = collideCapsules(pos, clearance);
    if (any(pushed != pos)) {
      let n = normalize(pushed - pos);
      pos = applyFriction(pushed, n, prev, params.friction);
      moved = true;
    }
  }

  // Floor collision: particles cannot pass through the plane y = floorY.
  let floorLimit = params.floorY + clearance;
  if (pos.y < floorLimit) {
    let floorN = vec3<f32>(0.0, 1.0, 0.0);
    pos = applyFriction(vec3<f32>(pos.x, floorLimit, pos.z), floorN, prev, params.friction);
    pos.y = floorLimit;
    moved = true;
  }

  if (moved) {
    predicted[i] = vec4<f32>(pos, 0.0);
  }
}
`;

// ============ Velocity update + position writeback pass ============
export const UPDATE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  maxSpeed: f32,
  _p0: f32,
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> prevPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: SimParams;
@group(0) @binding(5) var<storage, read> particleDamping: array<f32>;

@compute @workgroup_size(256)
fn updateVelocity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let prev = prevPos[i];
  let pred = predicted[i];
  let invMass = prev.w;
  if (invMass == 0.0) { return; }

  // v = (x_pred - x_prev) / dt
  var vel = (pred.xyz - prev.xyz) / params.dt;
  // Damping.
  vel = vel * (1.0 - particleDamping[i]);
  // Clamp to max speed.
  let speed = length(vel);
  if (speed > params.maxSpeed) { vel = vel / speed * params.maxSpeed; }

  velocity[i] = vec4<f32>(vel, 0.0);
  // Write back the position, keeping inverse mass.
  posInvMass[i] = vec4<f32>(pred.xyz, invMass);
}
`;

// ============ Normal computation pass ============
export const NORMALS_WGSL = /* wgsl */`
struct SimParams {
  triangleCount: u32,
  particleCount: u32,
  _p0: f32,
  _p1: f32,
};

@group(0) @binding(0) var<storage, read> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> normals: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn computeNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tri = gid.x;
  if (tri >= params.triangleCount) { return; }

  let i0 = indices[tri * 3u + 0u];
  let i1 = indices[tri * 3u + 1u];
  let i2 = indices[tri * 3u + 2u];
  let p0 = posInvMass[i0].xyz;
  let p1 = posInvMass[i1].xyz;
  let p2 = posInvMass[i2].xyz;

  // Unnormalized cross product = 2x face area, so accumulation is area-weighted.
  let n = cross(p1 - p0, p2 - p0);

  // Accumulate face normals per particle; a separate pass normalizes them.
  normals[i0] = normals[i0] + vec4<f32>(n, 0.0);
  normals[i1] = normals[i1] + vec4<f32>(n, 0.0);
  normals[i2] = normals[i2] + vec4<f32>(n, 0.0);
}
`;

// ============ Normal normalization pass ============
export const NORMALIZE_WGSL = /* wgsl */`
struct NormParams {
  particleCount: u32,
  _p0: u32,
  _p1: u32,
  _p2: u32,
};

@group(0) @binding(0) var<storage, read_write> normals: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: NormParams;

@compute @workgroup_size(256)
fn normalizeNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  let n = normals[i].xyz;
  let len = length(n);
  if (len > 1e-7) {
    normals[i] = vec4<f32>(n / len, 0.0);
  } else {
    normals[i] = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  }
}
`;

// ============ Normal clear pass ============
export const CLEAR_NORMALS_WGSL = /* wgsl */`
struct NormParams {
  particleCount: u32,
  _p0: u32,
  _p1: u32,
  _p2: u32,
};

@group(0) @binding(0) var<storage, read_write> normals: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: NormParams;

@compute @workgroup_size(256)
fn clearNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  normals[i] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
}
`;

// ============ Pin/unpin pass (inverse mass write) ============
export const SET_PIN_WGSL = /* wgsl */`
struct PinParams {
  indexCount: u32,
  particleCount: u32,
  _p0: u32,
  _p1: u32,
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> pinIndices: array<u32>;
@group(0) @binding(2) var<uniform> params: PinParams;
@group(0) @binding(3) var<storage, read> pinInvMass: array<f32>;

@compute @workgroup_size(256)
fn setPin(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.indexCount) { return; }
  let p = pinIndices[i];
  if (p >= params.particleCount) { return; }
  posInvMass[p] = vec4<f32>(posInvMass[p].xyz, pinInvMass[i]);
}
`;
