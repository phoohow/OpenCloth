import type { ProgramLibrary } from '@/render/backend/programs';
import type { PreviewFrame, PreviewPass } from '@/render/renderer/frame/pass';

const PREVIEW_TONE_CURVE = 'aces';

const PREVIEW_EXPOSURE = 1;

export class PreviewTonePass implements PreviewPass {
  readonly id = 'tone';
  readonly slot = 'tone' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['display'] as const;

  constructor(private readonly programs: ProgramLibrary) {}

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
