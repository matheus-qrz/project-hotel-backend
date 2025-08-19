export function parseDataURL(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const [, mime, b64] = m;
  return { mime, buffer: Buffer.from(b64, 'base64') };
}
