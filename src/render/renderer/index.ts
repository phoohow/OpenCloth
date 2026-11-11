/** Renderer facade: the two factories and the view types they consume. */

export { createRenderer, type Renderer, type RendererDeps } from '@/render/renderer/renderer';
export {
  createPreviewer, type PreviewDeps, type Previewer,
} from '@/render/renderer/previewPipeline';
export type {
  DrawItem, DrawList, MaterialVariant, RenderView,
} from '@/render/renderer/view/types';
