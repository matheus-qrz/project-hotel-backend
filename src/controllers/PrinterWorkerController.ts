import type { Request, Response } from "express";
import crypto from "crypto";
import { PrinterWorkerToken } from "../models/PrinterWorkerToken";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export const listPrinterWorkersController = async (req: Request, res: Response) => {
  try {
    // ✅ regra simples:
    // ADMIN pode listar por restaurantId/unitId via query
    // MANAGER (ideal): você ignora query e usa req.user.unitId (se existir).
    const { restaurantId, unitId } = req.query as any;

    const filter: any = {};
    if (restaurantId) filter.restaurantId = String(restaurantId);
    if (unitId) filter.unitId = String(unitId);

    const docs = await PrinterWorkerToken.find(filter)
      .select("restaurantId unitId name stations isActive lastSeenAt createdAt updatedAt")
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
    const { restaurantId, unitId, name, stations } = req.body ?? {};

    if (!restaurantId) return res.status(400).json({ message: "restaurantId é obrigatório" });
    if (!name) return res.status(400).json({ message: "name é obrigatório" });

    const unitIdNormalized = unitId ? String(unitId) : null;

    // token “bruto” só aparece uma vez
    const rawToken = crypto.randomBytes(32).toString("hex");
    const token = sha256(rawToken);

    const doc = await PrinterWorkerToken.create({
      token,
      restaurantId: String(restaurantId),
      unitId: unitIdNormalized,
      name: String(name),
      stations: Array.isArray(stations) ? stations.map(String) : [],
      isActive: true,
      lastSeenAt: null,
    });

    // ✅ retorna token uma única vez
    return res.status(201).json({
      id: doc._id,
      token: rawToken,
      restaurantId: doc.restaurantId,
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
