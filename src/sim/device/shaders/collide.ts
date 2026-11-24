export const COLLIDE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  surfaceOffset: f32,
  contactFrictionScale: f32,
  floorY: f32,
  clothThickness: f32,
  triangleCount: u32,
  floorCollision: u32,
  gridOrigin: vec4<f32>,
  gridDims: vec4<f32>,
};

struct SurfaceHit {
  point: vec3<f32>,
  distance: f32,
  side: f32,
};

const MAX_CONTACT_MOVE = 0.02;

@group(0) @binding(0) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: SimParams;
@group(0) @binding(2) var<storage, read> prevPos: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> meshTriangles: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> cellStart: array<u32>;
@group(0) @binding(5) var<storage, read> cellTriangles: array<u32>;
@group(0) @binding(6) var<storage, read_write> contactMove: array<f32>;
@group(0) @binding(7) var<storage, read> thickness: array<f32>;
@group(0) @binding(8) var<storage, read> friction: array<f32>;

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

fn cellDistance2(p: vec3<f32>, origin: vec3<f32>, ix: i32, iy: i32, iz: i32, cell: f32) -> f32 {
  let lo = origin + vec3<f32>(f32(ix), f32(iy), f32(iz)) * cell;
  let outside = max(max(lo - p, p - (lo + vec3<f32>(cell))), vec3<f32>(0.0));
  return dot(outside, outside);
}

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
            hit.side = select(-1.0, 1.0, dot(off, cross(b - a, c - a)) >= 0.0);
          }
        }
      }
    }
  }
  return hit;
}

fn applyFriction(pos: vec3<f32>, n: vec3<f32>, prev: vec3<f32>, normalDepth: f32, mu: f32) -> vec3<f32> {
  if (mu <= 0.0) { return pos; }
  let toPrev = prev - pos;
  let slip = toPrev - dot(toPrev, n) * n;
  let slipLength = length(slip);
  if (slipLength < 1e-9) { return pos; }
  let limit = mu * min(normalDepth, MAX_CONTACT_MOVE);
  return pos + slip * min(1.0, limit / slipLength);
}

@compute @workgroup_size(256)
fn collide(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let start = predicted[i].xyz;
  var pos = start;
  var moved = false;
  let clearance = params.surfaceOffset + thickness[i];
  let prev = prevPos[i].xyz;
  let mu = friction[i] * params.contactFrictionScale;

  if (params.triangleCount > 0u) {
    let cell = params.gridOrigin.w;
    var hit = nearestSurface(pos, 1);
    if (hit.distance > cell) {
      let wide = nearestSurface(pos, 3);
      if (wide.distance < hit.distance) { hit = wide; }
    }
    if (hit.side < 0.0 || hit.distance < clearance) {
      let off = pos - hit.point;
      let len = length(off);
      var n = vec3<f32>(0.0, 1.0, 0.0);
      if (len > 1e-6) { n = off / len * hit.side; }
      let surfacePoint = hit.point + n * clearance;
      let indent = max(dot(surfacePoint - start, n), 0.0);
      contactMove[i] = max(contactMove[i], min(indent, MAX_CONTACT_MOVE));
      pos = applyFriction(surfacePoint, n, prev, indent, mu);
      moved = true;
    }
  }

  let floorLimit = params.floorY + clearance;
  if (params.floorCollision != 0u && pos.y < floorLimit) {
    let floorN = vec3<f32>(0.0, 1.0, 0.0);
    let indent = floorLimit - pos.y;
    contactMove[i] = max(contactMove[i], min(indent, MAX_CONTACT_MOVE));
    pos = applyFriction(vec3<f32>(pos.x, floorLimit, pos.z), floorN, prev, indent, mu);
    pos.y = floorLimit;
    moved = true;
  }

  if (moved) {
    predicted[i] = vec4<f32>(pos, 0.0);
  }
}
`;
