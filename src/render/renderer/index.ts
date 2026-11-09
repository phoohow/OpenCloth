/** Renderer facade and the view types it consumes. */

export { createRenderer, type Renderer, type RendererDeps } from '@/render/renderer/renderer';
export { SceneBuilder, snapshotSignature } from '@/render/renderer/sceneBuilder';
export * from '@/render/renderer/view';
export { FrameGraph } from '@/render/renderer/frame/graph';
export { RendererFrameResources } from '@/render/renderer/frame/resources';
export {
  idleTrace, resetTrace, type FrameConditions, type FrameSize, type FrameResources,
  type PassContext, type PassSlot, type RenderPass, type ResourceId, type TraceOutput,
} from '@/render/renderer/frame/pass';
