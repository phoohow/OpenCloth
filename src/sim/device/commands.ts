import type { ResourceLedger } from '@/sim/device/buffers';

export interface DevicePort {
  device(): GPUDevice;
}

export type ProgramHandle = GPUComputePipeline;

export type BindGroupHandle = GPUBindGroup;

export type BufferHandle = GPUBuffer;

export interface ComputeCommands {
  begin(): void;
  dispatch(pipeline: ProgramHandle, bindGroup: BindGroupHandle, groups: number): void;
  write(buffer: BufferHandle, data: ArrayBufferView): void;
  copy(source: BufferHandle, target: BufferHandle, bytes: number): void;
  submit(): void;
  submitted(): Promise<void>;
  readonly dispatched: number;
}

export interface DeviceServices {
  readonly commands: ComputeCommands;
  readonly ledger: ResourceLedger;
  bindGroup(layout: GPUBindGroupLayout, buffers: readonly GPUBuffer[]): BindGroupHandle;
  storageSized(bytes: number): GPUBuffer;
}

export class GpuCommands implements ComputeCommands {
  private encoder: GPUCommandEncoder | null = null;
  dispatched = 0;

  constructor(private readonly device: GPUDevice) {}

  begin(): void {
    this.encoder = this.device.createCommandEncoder();
  }

  dispatch(pipeline: ProgramHandle, bindGroup: BindGroupHandle, groups: number): void {
    const pass = this.ensure().beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.max(1, groups));
    pass.end();
    this.dispatched++;
  }

  write(buffer: BufferHandle, data: ArrayBufferView): void {
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }

  copy(source: BufferHandle, target: BufferHandle, bytes: number): void {
    this.ensure().copyBufferToBuffer(source, 0, target, 0, bytes);
  }

  submitted(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }

  private ensure(): GPUCommandEncoder {
    this.encoder ??= this.device.createCommandEncoder();
    return this.encoder;
  }

  submit(): void {
    const encoder = this.encoder;
    if (!encoder) return;
    this.encoder = null;
    this.device.queue.submit([encoder.finish()]);
  }
}
