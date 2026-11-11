/** Tone maps the drawn preview into the display image it is read back from. */

import type { ProgramLibrary } from '@/render/backend/programs';
import type { PreviewFrame, PreviewPass } from '@/render/renderer/frame/pass';

/** Tone curve of a preview: the viewport's default, so a row matches the scene. */
const PREVIEW_TONE_CURVE = 'aces';
const PREVIEW_EXPOSURE = 1;

/** Tone slot: last pass of a preview, resolves the scene image into the display target. */
export class PreviewTonePass implements PreviewPass {
  readonly id = 'tone';
  readonly slot = 'tone' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['display'] as const;

  constructor(private readonly programs: ProgramLibrary) { }

  execute(frame: PreviewFrame): void {
    frame.commands.setTarget(frame.resources.display, true);
    this.programs.toneMap(
      frame.commands,
      frame.resources.texture(frame.resources.color),
      frame.resources.display,
      PREVIEW_TONE_CURVE,
      PREVIEW_EXPOSURE,
    );
  }
}
