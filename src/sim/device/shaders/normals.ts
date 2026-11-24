export const NORMALS_WGSL = /* wgsl */`
struct SimParams {
  particleCount: u32,
  _p0: u32,
  _p1: u32,
  _p2: u32,
};

@group(0) @binding(0) var<storage, read> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> normals: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read> groupStart: array<u32>;
@group(0) @binding(4) var<storage, read> groupTriangles: array<u32>;
@group(0) @binding(5) var<storage, read> groupOfParticle: array<u32>;
@group(0) @binding(6) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn computeNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let group = groupOfParticle[i];
  let start = groupStart[group];
  let end = groupStart[group + 1u];

  var sum = vec3<f32>(0.0);
  var own = vec3<f32>(0.0);
  for (var k = start; k < end; k++) {
    let tri = groupTriangles[k] * 3u;
    let i0 = indices[tri];
    let i1 = indices[tri + 1u];
    let i2 = indices[tri + 2u];
    let p0 = posInvMass[i0].xyz;
    let p1 = posInvMass[i1].xyz;
    let p2 = posInvMass[i2].xyz;
    let n = cross(p1 - p0, p2 - p0);
    sum = sum + n;
    if (i0 == i || i1 == i || i2 == i) { own = own + n; }
  }

  let ownLen = length(own);
  let sumLen = length(sum);
  var n = vec3<f32>(0.0, 1.0, 0.0);
  if (ownLen > 1e-12) {
    let ownN = own / ownLen;
    n = ownN;
    if (sumLen > 1e-12) {
      let sumN = sum / sumLen;
      if (dot(sumN, ownN) >= 0.3) { n = sumN; }
    }
  }
  normals[i] = vec4<f32>(n, 0.0);
}
`;
