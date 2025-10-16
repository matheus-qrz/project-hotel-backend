export function parseDataURL(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const [, mime, b64] = m;
  return { mime, buffer: Buffer.from(b64, 'base64') };
}

export function extFromMime(mime: string) {
  // cobre os mais comuns; ajuste se usar webp/avif
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}