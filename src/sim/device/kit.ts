import type { DevicePort, DeviceServices } from '@/sim/device/commands';

import { bindGroupOf, createStorageSized, ResourceLedger } from '@/sim/device/buffers';
import { GpuCommands } from '@/sim/device/commands';
import { assertCompiled, createPrograms, type Programs } from '@/sim/device/programs';
import { ReadbackSlots } from '@/sim/device/readback';
import { LayoutBuffers } from '@/sim/device/resources';

export interface SimDevice extends DeviceServices {
  readonly programs: Programs;
  layoutBuffers(): LayoutBuffers;
  readbackSlots(particleCount: number): ReadbackSlots;
  compiled(): Promise<void>;
}

export function createSimDevice(port: DevicePort): SimDevice {
  const device = port.device();
  const ledger = new ResourceLedger(device);
  const commands = new GpuCommands(device);
  const programs = createPrograms(device);
  return {
    programs,
    commands,
    ledger,
    bindGroup: (layout, buffers) => bindGroupOf(device, layout, buffers),
    storageSized: bytes => ledger.track(createStorageSized(device, bytes)),
    layoutBuffers: () => new LayoutBuffers(device, programs, ledger, commands),
    readbackSlots: particleCount => new ReadbackSlots(device, particleCount, ledger),
    compiled: () => assertCompiled(programs),
  };
}
