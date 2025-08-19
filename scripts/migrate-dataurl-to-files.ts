// scripts/migrate-dataurl-to-files.ts
import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

// ---- Ajuste o caminho do seu model:
import { ProductModel } from '../src/models/Products';

// Onde salvar os arquivos (o Express deve servir isso como /uploads)
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'products');

// Flags por env
const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.LIMIT || '0'); // 0 = sem limite

function parseDataURL(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const [, mime, b64] = m;
  return { mime, buffer: Buffer.from(b64, 'base64') };
}

async function processAndSaveProductImage(buf: Buffer) {
  const id = nanoid();
  const baseDir = path.join(UPLOADS_DIR, id);
  await fs.mkdir(baseDir, { recursive: true });

  const base = sharp(buf).rotate();
  const meta = await base.metadata();
  const prepared = base.resize({
    width: Math.min(meta.width ?? 3840, 3840),
    withoutEnlargement: true,
  });

  await Promise.all([
    prepared.clone().jpeg({ quality: 80 }).toFile(path.join(baseDir, 'original.jpg')),
    prepared.clone().webp({ quality: 70 }).toFile(path.join(baseDir, 'original.webp')),
    prepared.clone().avif({ quality: 50 }).toFile(path.join(baseDir, 'original.avif')),
  ]);

  const tiny = await prepared.clone().resize(16).jpeg({ quality: 40 }).toBuffer();
  const blurDataURL = `data:image/jpeg;base64,${tiny.toString('base64')}`;

  // URL pública (o Next acessará como "/_api/uploads/..." via rewrite)
  const publicUrl = `/uploads/products/${id}/original.jpg`;

  return {
    url: publicUrl,
    blurDataURL,
    width: meta.width ?? undefined,
    height: meta.height ?? undefined,
  };
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ Defina MONGO_URI (ou DATABASE_URL) no .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Conectado ao Mongo');

  const query = { image: { $regex: '^data:image/' } };
  const total = await ProductModel.countDocuments(query);
  console.log(`Encontrados ${total} produtos com image em data URL`);

  const cursor = ProductModel.find(query).cursor();
  let processed = 0;

  for await (const p of cursor) {
    if (LIMIT && processed >= LIMIT) break;

    const raw: string = (p as any).image;
    const parsed = parseDataURL(raw);
    if (!parsed) continue;

    if (DRY_RUN) {
      console.log(`[DRY] ${p._id} seria migrado`);
      processed++;
      continue;
    }

    const out = await processAndSaveProductImage(parsed.buffer);
    (p as any).image = out.url;
    (p as any).imageBlur = out.blurDataURL;
    (p as any).imageWidth = out.width;
    (p as any).imageHeight = out.height;
    await p.save();

    processed++;
    if (processed % 25 === 0) {
      console.log(`... ${processed} migrados`);
    }
  }

  console.log(`✅ Migração concluída. Migrados: ${processed}`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
