// infra/image.ts
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { randomBytes } from "crypto";

// ID curto, seguro, sem caracteres problemáticos
function makeId(len = 12) {
  // base64url evita + / = ; corta no tamanho desejado
  return randomBytes(Math.ceil((len * 3) / 4)).toString("base64url").slice(0, len);
}

// Diretório base dos uploads (use UPLOADS_DIR=/app/uploads em produção/Railway)
const UPLOADS_BASE = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

export async function processAndSaveProductImage(
  buf: Buffer,
  folder = "products"
) {
  const id = makeId(); // substitui nanoid()
  const baseDir = path.join(UPLOADS_BASE, folder, id);
  await fs.mkdir(baseDir, { recursive: true });

  const base = sharp(buf).rotate(); // corrige orientação EXIF
  const meta = await base.metadata();
  const targetW = Math.min(meta.width ?? 3840, 3840); // limite 4K
  const prepared = base.resize({ width: targetW, withoutEnlargement: true });

  // Arquivo “canônico” + alternativas (opt-in)
  await Promise.all([
    prepared.clone().jpeg({ quality: 80 }).toFile(path.join(baseDir, "original.jpg")),
    prepared.clone().webp({ quality: 70 }).toFile(path.join(baseDir, "original.webp")),
    prepared.clone().avif({ quality: 50 }).toFile(path.join(baseDir, "original.avif")),
  ]);

  // LQIP (16 px) em base64 para placeholder
  const tiny = await prepared.clone().resize(16).jpeg({ quality: 40 }).toBuffer();
  const blurDataURL = `data:image/jpeg;base64,${tiny.toString("base64")}`;

  // URL pública (o Next reescreve /uploads/* → backend)
  const publicUrl = `/uploads/${folder}/${id}/original.jpg`;

  return {
    url: publicUrl,
    blurDataURL,
    width: meta.width ?? undefined,
    height: meta.height ?? undefined,
  };
}
