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
