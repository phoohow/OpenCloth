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
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> prevPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: SimParams;

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
  let pred = pos.xyz + vel.xyz * dt + accel * dt * dt;
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

// ============ Body collision pass (analytic capsule SDF) + floor collision ============
export const COLLIDE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  capsuleCount: u32,
  surfaceOffset: f32,
  friction: f32,
  floorY: f32,
  _p1: f32,
  _p2: f32,
};

struct Capsule {
  a: vec4<f32>,   // xyz = start point, w = radius x
  b: vec4<f32>,   // xyz = end point, w = radius z (0 falls back to radius x)
};

@group(0) @binding(0) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> capsules: array<Capsule>;
@group(0) @binding(2) var<uniform> params: SimParams;
@group(0) @binding(3) var<storage, read> prevPos: array<vec4<f32>>;

fn pointSegmentClosest(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
  let ab = b - a;
  let ap = p - a;
  let abLen2 = dot(ab, ab);
  var t = 0.0;
  if (abLen2 > 0.0) { t = clamp(dot(ap, ab) / abLen2, 0.0, 1.0); }
  return a + ab * t;
}

@compute @workgroup_size(256)
fn collide(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  var pos = predicted[i].xyz;
  var moved = false;

  // Minimum penetration across all capsules (body collision).
  if (params.capsuleCount > 0u) {
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
    // If penetrating (dist < surfaceOffset), push back to the surface.
    if (minDist < params.surfaceOffset) {
      let dir = pos - bestClosest;
      let dirLen = length(dir);
      var n = vec3<f32>(0.0, 1.0, 0.0);
      if (dirLen > 1e-7) { n = dir / dirLen; }
      let targetDist = bestRadius + params.surfaceOffset;
      pos = bestClosest + n * targetDist;
      moved = true;
      // Friction: pull the tangential position toward the previous frame position; the normal component is unchanged.
      let prev = prevPos[i].xyz;
      let toPrev = prev - pos;
      let toPrevT = toPrev - dot(toPrev, n) * n;
      pos = pos + toPrevT * params.friction;
    }
  }

  // Floor collision: particles cannot pass through the plane y = floorY.
  let floorLimit = params.floorY + params.surfaceOffset;
  if (pos.y < floorLimit) {
    pos.y = floorLimit;
    moved = true;
    // Tangential floor friction.
    let prev = prevPos[i].xyz;
    let floorN = vec3<f32>(0.0, 1.0, 0.0);
    let toPrev = prev - pos;
    let toPrevT = toPrev - dot(toPrev, floorN) * floorN;
    pos = pos + toPrevT * params.friction;
    pos.y = floorLimit;
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
  damping: f32,
  maxSpeed: f32,
  _p0: vec3<f32>,
  _p1: f32,
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> prevPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: SimParams;

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
  vel = vel * (1.0 - params.damping);
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
