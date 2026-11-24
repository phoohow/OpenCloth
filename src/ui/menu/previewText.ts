const MAX_PREVIEW = 200_000;

export function previewText(body: string): { text: string; truncated: boolean } {
  return { text: body.slice(0, MAX_PREVIEW), truncated: body.length > MAX_PREVIEW };
}
