/** Whether this browser can run the WebGPU renderer at all. */

/** Probes for a usable WebGPU adapter before a renderer is created. */
export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await navigator.gpu.requestAdapter();
  return !!adapter;
}
