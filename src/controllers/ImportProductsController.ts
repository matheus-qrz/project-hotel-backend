import type { Request, Response } from "express";
import Papa from "papaparse";
import iconv from "iconv-lite";
import mongoose from "mongoose";
import { ProductModel } from "../models/Products"; // ajuste o path para o seu model

type ImportRowRaw = Record<string, unknown>;

type ImportRowNormalized = {
  name: string;
  price: number;
  category: string;
  description?: string;
  image?: string;
  quantity: number;
  isAvailable?: boolean;
};

type ImportError = { row?: number; field?: string; message: string };

const REQUIRED_HEADERS = ["name", "price", "category"];
const OPTIONAL_HEADERS = ["description", "image", "quantity", "isAvailable"];
const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

const toString = (v: unknown) => (v == null ? "" : String(v).trim());

const normalizePrice = (v: unknown): number | null => {
  const s = toString(v);
  if (!s) return null;
  // aceita 12.34 ou 12,34 (e remove separador de milhar)
  const parsed = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeQuantity = (v: unknown): number | null => {
  const s = toString(v);
  if (!s) return null; // vamos tratar default depois
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

const normalizeBool = (v: unknown): boolean | undefined => {
  const s = toString(v).toLowerCase();
  if (!s) return undefined;
  if (["true", "1", "sim", "yes"].includes(s)) return true;
  if (["false", "0", "nao", "não", "no"].includes(s)) return false;
  return undefined; // inválido -> tratado na validação
};

const validateHeaders = (headers: string[]): ImportError[] => {
  const lower = headers.map((h) => h.toLowerCase());
  const errs: ImportError[] = [];
  for (const h of REQUIRED_HEADERS) {
    if (!lower.includes(h.toLowerCase())) {
      errs.push({ message: `Coluna obrigatória ausente: ${h}` });
    }
  }
  return errs;
};

const validateRows = (rows: ImportRowRaw[], headers: string[]): ImportError[] => {
  const errs: ImportError[] = [];

  rows.forEach((r, idx) => {
    const row = idx + 2; // header é linha 1
    const name = toString(r["name"]);
    const price = normalizePrice(r["price"]);
    const category = toString(r["category"]);

    if (!name) errs.push({ row, field: "name", message: "name é obrigatório" });
    if (price == null) errs.push({ row, field: "price", message: "price inválido (use 12.34 ou 12,34)" });
    if (!category) errs.push({ row, field: "category", message: "category é obrigatório" });

    // quantity é required no schema — se vier vazio, aceitaremos default 0; se vier inválido, erro
    const qRaw = r["quantity"];
    if (qRaw != null && toString(qRaw) !== "") {
      const q = normalizeQuantity(qRaw);
      if (q == null) errs.push({ row, field: "quantity", message: "quantity deve ser inteiro >= 0" });
    }

    const avRaw = r["isAvailable"];
    if (avRaw != null && toString(avRaw) !== "") {
      const b = normalizeBool(avRaw);
      if (typeof b === "undefined") {
        errs.push({
          row,
          field: "isAvailable",
          message: 'isAvailable deve ser true/false (aceita "1/0", "sim/não")',
        });
      }
    }
  });

  return errs;
};

const normalizeAll = (rows: ImportRowRaw[]): ImportRowNormalized[] => {
  return rows
    .map((r) => {
      const name = toString(r["name"]);
      const price = normalizePrice(r["price"]);
      const category = toString(r["category"]);
      if (!name || price == null || !category) return null;

      const description = toString(r["description"]) || undefined;
      const image = toString(r["image"]) || undefined;

      const q = normalizeQuantity(r["quantity"]);
      const quantity = q == null ? 0 : q; // default 0 para atender schema required

      const isAvailable = normalizeBool(r["isAvailable"]);

      return { name, price, category, description, image, quantity, isAvailable } as ImportRowNormalized;
    })
    .filter(Boolean) as ImportRowNormalized[];
};

export async function importProductsController(req: Request, res: Response) {
  try {
    const restaurantId = req.params.id;
    const dryRun = String(req.query.dryRun || req.query.dryrun || "").toLowerCase() === "true";

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Arquivo CSV não enviado (campo 'file' ausente).",
      });
    }

    // Tentar decodificar buffer (UTF-8 e fallback para latin1 caso necessário)
    let csvText = "";
    try {
      csvText = iconv.decode(req.file.buffer, "utf-8");
      // heurística simples: se tiver caractere � demais, tenta latin1
      const bad = (csvText.match(/\uFFFD/g) || []).length;
      if (bad > 5) csvText = iconv.decode(req.file.buffer, "latin1");
    } catch {
      csvText = req.file.buffer.toString("utf-8");
    }

    // Parse CSV
    const parsed = Papa.parse<ImportRowRaw>(csvText, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transform: (v: any) => (typeof v === "string" ? v.trim() : v),
    });

    if (parsed.errors?.length) {
      return res.status(400).json({
        success: false,
        message: "Falha ao ler o CSV.",
        errors: parsed.errors.map((e: any) => ({ message: e.message })),
      });
    }

    const headers = (parsed.meta.fields || []).map((h: any) => (h ?? "").toString().trim());
    const rows = (parsed.data || []) as ImportRowRaw[];

    // Validação
    const headerErrs = validateHeaders(headers);
    const rowErrs = validateRows(rows, headers);
    const errors: ImportError[] = [...headerErrs, ...rowErrs];

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: "Erros de validação encontrados.",
        errors,
      });
    }

    // Normalização
    const normalized = normalizeAll(rows);
    if (!normalized.length) {
      return res.status(400).json({
        success: false,
        message: "Nenhuma linha válida para importar.",
      });
    }

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        summary: { inserted: 0, updated: 0, skipped: 0, total: normalized.length },
        errors: [],
      });
    }

    // Upsert transacional
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of normalized) {
        // Critério de unicidade: (restaurantId, name)
        // Se você tiver SKU, troque aqui por { restaurant: restaurantId, sku: row.sku }
        const filter = { restaurant: restaurantId, name: row.name };

        // Tente encontrar existente
        const existing = await ProductModel.findOne(filter).session(session);

        if (!existing) {
          // criar novo
          await ProductModel.create(
            [
              {
                restaurant: restaurantId,
                name: row.name,
                price: row.price,
                category: row.category,
                description: row.description,
                image: row.image,
                quantity: row.quantity, // required no schema
                isAvailable: typeof row.isAvailable === "boolean" ? row.isAvailable : true,
              },
            ],
            { session },
          );
          inserted++;
        } else {
          // atualizar existente
          existing.price = row.price;
          existing.category = row.category;
          if (typeof row.description === "string") existing.description = row.description;
          if (row.image !== undefined) existing.image = row.image;
          // regra: se quantity vier no CSV, atualiza; se não vier, mantém
          if (typeof row.quantity === "number") existing.quantity = row.quantity;
          if (typeof row.isAvailable === "boolean") existing.isAvailable = row.isAvailable;
          await existing.save({ session });
          updated++;
        }
      }

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success: true,
        message: "Importação concluída.",
        importedCount: inserted + updated,
        summary: { inserted, updated, skipped, total: normalized.length },
        errors: [],
      });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      throw e;
    }
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Erro interno ao importar produtos.",
    });
  }
}
