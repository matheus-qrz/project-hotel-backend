import type { Request, Response } from "express";
import crypto from "crypto";
import { PrinterWorkerToken } from "../models/PrinterWorkerToken";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export const listPrinterWorkersController = async (req: Request, res: Response) => {
  try {
    // ✅ regra simples:
    // ADMIN pode listar por hotelId/unitId via query
    // MANAGER (ideal): você ignora query e usa req.user.unitId (se existir).
    const { hotelId, unitId } = req.query as any;

    const filter: any = {};
    if (hotelId) filter.hotelId = String(hotelId);
    if (unitId) filter.unitId = String(unitId);

    const docs = await PrinterWorkerToken.find(filter)
      .select("hotelId unitId name stations isActive lastSeenAt createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json(docs);
  } catch (e) {
    console.error("listPrinterWorkersController error:", e);
    return res.status(500).json({ message: "Erro ao listar dispositivos" });
  }
};

export const createPrinterWorkerController = async (req: Request, res: Response) => {
  try {
    const { hotelId, name, stations } = req.body ?? {};

    if (!hotelId) {
      return res.status(400).json({ message: "hotelId é obrigatório" });
    }
    if (!name) {
      return res.status(400).json({ message: "name é obrigatório" });
    }

    // ✅ pega unitId de múltiplos campos possíveis (compatível com o teu sistema)
    const unitIdRaw =
      req.body?.unitId ??
      req.body?.restaurantUnitId ??
      req.body?.restaurantUnit;

    const unitId = String(unitIdRaw ?? "").trim();

    // ✅ bloqueia casos problemáticos que viram string no JSON/env
    if (!unitId || unitId === "undefined" || unitId === "null") {
      return res.status(400).json({
        message: "unitId é obrigatório e válido (use unitId/restaurantUnitId/restaurantUnit).",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const token = sha256(rawToken);

    const doc = await PrinterWorkerToken.create({
      token,
      hotelId: String(hotelId).trim(),
      unitId, // ✅ sempre string válida agora
      name: String(name).trim(),
      stations: Array.isArray(stations) ? stations.map((s: any) => String(s).trim()) : [],
      isActive: true,
      lastSeenAt: null,
    });

    return res.status(201).json({
      id: doc._id,
      token: rawToken, // ✅ só retorna uma vez
      hotelId: doc.hotelId,
      unitId: doc.unitId,
      name: doc.name,
      stations: doc.stations,
      isActive: doc.isActive,
    });
  } catch (e: any) {
    console.error("createPrinterWorkerController error:", e);
    return res.status(500).json({ message: "Erro ao criar dispositivo" });
  }
};

export const revokePrinterWorkerController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const doc = await PrinterWorkerToken.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ message: "Dispositivo não encontrado" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("revokePrinterWorkerController error:", e);
    return res.status(500).json({ message: "Erro ao revogar dispositivo" });
  }
};
