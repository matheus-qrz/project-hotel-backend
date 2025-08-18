// infra/image.ts
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export async function processAndSaveProductImage(
  buf: Buffer,
  folder = "products"
) {
  const id = nanoid();
  const baseDir = path.join(process.cwd(), "uploads", folder, id);
  await fs.mkdir(baseDir, { recursive: true });

  const base = sharp(buf).rotate();               // corrige orientação EXIF
  const meta = await base.metadata();
  const targetW = Math.min(meta.width ?? 3840, 3840); // limita a 4K
  const prepared = base.resize({ width: targetW, withoutEnlargement: true });

  // Arquivo "canônico" (JPEG) + alternativas (opcional)
  await Promise.all([
    prepared.clone().jpeg({ quality: 80 }).toFile(path.join(baseDir, "original.jpg")),
    prepared.clone().webp({ quality: 70 }).toFile(path.join(baseDir, "original.webp")),
    prepared.clone().avif({ quality: 50 }).toFile(path.join(baseDir, "original.avif")),
  ]);

  // LQIP (16 px) como base64
  const tiny = await prepared.clone().resize(16).jpeg({ quality: 40 }).toBuffer();
  const blurDataURL = `data:image/jpeg;base64,${tiny.toString("base64")}`;

  // URL pública canônica (pode apontar pro .jpg; o next/image decide o formato via Accept)
  const publicUrl = `/uploads/${folder}/${id}/original.jpg`;

  return {
    url: publicUrl,
    blurDataURL,
    width: meta.width ?? undefined,
    height: meta.height ?? undefined,
  };
}
