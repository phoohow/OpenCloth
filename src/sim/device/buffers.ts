export function createStorage(device: GPUDevice, data: ArrayBufferView | null): GPUBuffer {
  const size = data ? data.byteLength : 4;
  const buf = device.createBuffer({
    size: Math.max(size, 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  if (data) device.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  return buf;
}

export function createUniform(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(size, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function createStorageSized(device: GPUDevice, bytes: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(bytes, 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

export function bindGroupOf(
  device: GPUDevice, layout: GPUBindGroupLayout, buffers: readonly GPUBuffer[],
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: buffers.map((buffer, binding): GPUBindGroupEntry => ({ binding, resource: { buffer } })),
  });
}

export function createReadback(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(size, 4),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}

export class ResourceLedger {
  private readonly buffers = new Set<GPUBuffer>();

  constructor(readonly device: GPUDevice) {}

  storage(data: ArrayBufferView | null): GPUBuffer {
    return this.track(createStorage(this.device, data));
  }

  uniform(size: number): GPUBuffer {
    return this.track(createUniform(this.device, size));
  }

  track(buffer: GPUBuffer): GPUBuffer {
    this.buffers.add(buffer);
    return buffer;
  }

  release(buffer: GPUBuffer | undefined): void {
    if (!buffer) return;
    this.buffers.delete(buffer);
    buffer.destroy();
  }

  destroyAll(): void {
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers.clear();
  }
}
