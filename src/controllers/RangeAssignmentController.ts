// src/controllers/RangeAssignmentController.ts
import mongoose, { Types } from "mongoose";
import { Request, Response } from "express";
import { RangeAssignmentModel } from "../models/RangeAssignment";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";

/** 0=Dom ... 6=Sáb */
const normDays = (arr: any): number[] => {
  const set = new Set<number>();
  (Array.isArray(arr) ? arr : []).forEach((d) => {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  });
  return Array.from(set).sort((a, b) => a - b);
};

// "10:00" -> Date(1970-01-01T10:00:00.000Z)
const toTimeDate = (t?: string | null): Date | null => {
  if (!t) return null;
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    return new Date(Date.UTC(1970, 0, 1, h, m, 0, 0));
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
};

const parseHHmmToDate = (hhmm?: string | null) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  // salva como hora/minuto ancorado no epoch (UTC) só para ordenação/comparação
  const d = new Date(0);
  d.setUTCHours(h, m, 0, 0);
  return d;
};

/** =========================
 *  CRIAR / MESCLAR (upsert)
 *  ========================= */
export const createOrMergeRangeAssignment = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const {
      startTable,
      endTable,
      attendantId,
      label,
      startsAt,
      endsAt,
      daysOfWeek,
      isActive,
    } = req.body;

    // Validação: unitId obrigatório
    if (!unitId || !mongoose.Types.ObjectId.isValid(unitId)) {
      return res.status(400).json({ message: "ID da unidade inválido." });
    }

    const unit = await RestaurantUnitModel
      .findById(unitId)
      .select("_id restaurant")
      .lean<{ _id: Types.ObjectId; restaurant: Types.ObjectId | null }>()

    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada." });
    }

    // Validação: mesas
    const st = Number(startTable);
    const et = Number(endTable);
    if (!st || !et || st < 1 || et < st) {
      return res.status(400).json({ message: "Faixa de mesas inválida." });
    }

    // Validação: dias da semana
    const days = Array.isArray(daysOfWeek)
      ? [...new Set(daysOfWeek.map(Number).filter((d) => d >= 0 && d <= 6))]
      : [];
    if (!days.length) {
      return res.status(400).json({ message: "Selecione ao menos um dia da semana." });
    }

    // Validação: horários
    const startTime = startsAt ? new Date(`1970-01-01T${startsAt}:00Z`) : null;
    const endTime = endsAt ? new Date(`1970-01-01T${endsAt}:00Z`) : null;
    if ((startTime && !endTime) || (!startTime && endTime)) {
      return res.status(400).json({ message: "Informe ambos os horários de início e fim." });
    }
    if (startTime && endTime && endTime <= startTime) {
      return res.status(400).json({ message: "Horário final deve ser maior que o inicial." });
    }

    // Validação: atendente
    if (!attendantId || !mongoose.Types.ObjectId.isValid(attendantId)) {
      return res.status(400).json({ message: "ID do atendente inválido." });
    }

    const user = await UserModel.findById(attendantId);
    if (!user) {
      return res.status(404).json({ message: "Atendente não encontrado." });
    }

    const attendantName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();

    const payload = {
      restaurantUnit: unit._id,
      restaurant: unit.restaurant ?? null,
      startTable: Number(req.body.startTable),
      endTable: Number(req.body.endTable),
      attendant: req.body.attendantId ?? req.body.attendant ?? null,
      attendantName: req.body.attendantName ?? null,
      label: req.body.label ?? null,
      daysOfWeek: Array.isArray(req.body.daysOfWeek) ? req.body.daysOfWeek : [],
      startsAt: parseHHmmToDate(req.body.startsAt),
      endsAt: parseHHmmToDate(req.body.endsAt),
      isActive: true,
    };

    // Base para upsert
    const baseMatch = {
      unit,
      startTable: st,
      endTable: et,
      attendant: attendantId,
      label: label ?? null,
      startsAt: startTime,
      endsAt: endTime,
    };

    const now = new Date();

    const updated = await RangeAssignmentModel.findOneAndUpdate(
      baseMatch,
      {
        $setOnInsert: {
          ...baseMatch,
          daysOfWeek: [],
          attendantName,
          isActive: isActive !== false,
          createdAt: now,
          updatedAt: now,
        },
        $set: {
          attendantName,
          updatedAt: now,
        },
        $addToSet: {
          daysOfWeek: { $each: days },
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(201).json({
      message: "Escala aplicada com sucesso.",
      item: {
        id: String(updated._id),
        restaurantUnit: String(updated.restaurantUnit),
        startTable: updated.startTable,
        endTable: updated.endTable,
        attendantId: updated.attendant?.toString() ?? null,
        attendantName: updated.attendantName,
        label: updated.label,
        startsAt: updated.startsAt?.toISOString() ?? null,
        endsAt: updated.endsAt?.toISOString() ?? null,
        daysOfWeek: updated.daysOfWeek,
        isActive: updated.isActive,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Já existe uma escala igual para esse garçom/faixa/horário." });
    }

    console.error("Erro ao criar/atualizar escala:", error);
    return res.status(500).json({ message: "Erro interno ao aplicar escala." });
  }
};

/** =========================
 *  LISTAR (agregado, compat)
 *  ========================= */
export const listRangeAssignments = async (req: Request, res: Response) => {
  const { unitId } = req.params;
  try {
    const { attendantId, activeOnly } = (req.query || {}) as any;
    const match: any = {};
    if (unitId) match.restaurantUnit = unitId;
    if (attendantId && Types.ObjectId.isValid(attendantId)) match.attendant = new Types.ObjectId(attendantId);
    if (activeOnly === "true") match.isActive = { $ne: false };

    const pipeline = [
      { $match: match },
      { $unwind: { path: "$daysOfWeek", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            restaurantUnit: "$restaurantUnit",
            startTable: "$startTable",
            endTable: "$endTable",
            attendant: "$attendant",
            attendantName: "$attendantName",
            label: "$label",
            startsAt: "$startsAt",
            endsAt: "$endsAt",
          },
          days: { $addToSet: "$daysOfWeek" },
          isActive: { $max: { $cond: [{ $eq: ["$isActive", false] }, 0, 1] } },
          updatedAt: { $max: "$updatedAt" },
          anyId: { $first: "$_id" },
        },
      },
      {
        $project: {
          _id: 0,
          id: "$anyId",
          unitId: "$_id.restaurantUnit",
          startTable: "$_id.startTable",
          endTable: "$_id.endTable",
          attendantId: "$_id.attendant",
          attendantName: "$_id.attendantName",
          label: "$_id.label",
          startsAt: "$_id.startsAt",
          endsAt: "$_id.endsAt",
          daysOfWeek: {
            $filter: {
              input: "$days",
              as: "d",
              cond: { $and: [{ $ne: ["$$d", null] }, { $gte: ["$$d", 0] }, { $lte: ["$$d", 6] }] },
            },
          },
          isActive: { $cond: [{ $gt: ["$isActive", 0] }, true, false] },
          updatedAt: 1,
        },
      },
      { $sort: { attendantName: 1, startTable: 1, label: 1 } },
    ];

    const rows = await (RangeAssignmentModel as any).aggregate(pipeline);
    // normaliza saída
    const items = rows.map((d: any) => ({
      id: String(d.id),
      unitId: d.unitId ? String(d.unitId) : null,
      startTable: d.startTable,
      endTable: d.endTable,
      attendantId: d.attendantId ? String(d.attendantId) : null,
      attendantName: d.attendantName ?? null,
      label: d.label ?? null,
      startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : null,
      endsAt: d.endsAt ? new Date(d.endsAt).toISOString() : null,
      daysOfWeek: Array.isArray(d.daysOfWeek) ? [...d.daysOfWeek].sort((a: number, b: number) => a - b) : [],
      isActive: d.isActive !== false,
      updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
    }));

    return res.status(200).json({ items, count: items.length });
  } catch (e) {
    console.error("listRangeAssignments error:", e);
    return res.status(500).json({ message: "Erro ao listar escalas." });
  }
};

/** =========================
 *  SUBSTITUIR DIAS
 *  ========================= */
export const replaceDays = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID inválido." });

    const days = normDays((req.body || {}).daysOfWeek);
    if (!days.length) return res.status(400).json({ message: "Informe ao menos um dia." });

    const doc = await RangeAssignmentModel.findByIdAndUpdate(
      id,
      { $set: { daysOfWeek: days, updatedAt: new Date() } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Escala não encontrada." });

    return res.status(200).json({ message: "Dias atualizados.", daysOfWeek: days });
  } catch (e) {
    console.error("replaceDays error:", e);
    return res.status(500).json({ message: "Erro ao atualizar dias." });
  }
};

/** =========================
 *  ATIVAR / DESATIVAR
 *  ========================= */
export const toggleActive = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID inválido." });
    const doc = await RangeAssignmentModel.findById(id);
    if (!doc) return res.status(404).json({ message: "Escala não encontrada." });
    doc.isActive = !(doc.isActive === true);
    (doc as any).updatedAt = new Date();
    await doc.save();
    return res.status(200).json({ message: doc.isActive ? "Escala ativada." : "Escala desativada.", isActive: doc.isActive });
  } catch (e) {
    console.error("toggleActive error:", e);
    return res.status(500).json({ message: "Erro ao alternar status." });
  }
};

/** =========================
 *  UPDATE BÁSICO / DELETE
 *  ========================= */
export const updateRangeAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID inválido." });

    const patch: any = {};
    const b = (req.body || {}) as any;

    if (b.startTable != null) patch.startTable = Number(b.startTable);
    if (b.endTable != null) patch.endTable = Number(b.endTable);
    if (b.label !== undefined) patch.label = b.label ?? null;

    if (b.attendantId !== undefined || b.attendant !== undefined) {
      const raw = b.attendantId ?? b.attendant;
      if (raw) {
        if (!Types.ObjectId.isValid(raw)) return res.status(400).json({ message: "attendantId inválido." });
        patch.attendant = new Types.ObjectId(String(raw));
      } else {
        patch.attendant = null;
      }
    }
    if (b.attendantName !== undefined) patch.attendantName = b.attendantName ?? null;

    if (b.startsAt !== undefined || b.endsAt !== undefined) {
      const sa = toTimeDate(b.startsAt);
      const ea = toTimeDate(b.endsAt);
      if (!!sa !== !!ea) return res.status(400).json({ message: "Informe horário inicial e final." });
      if (sa && ea && ea <= sa) return res.status(400).json({ message: "Horário final deve ser maior que o inicial." });
      patch.startsAt = sa ?? null;
      patch.endsAt = ea ?? null;
    }

    patch.updatedAt = new Date();

    const updated = await RangeAssignmentModel.findByIdAndUpdate(id, { $set: patch }, { new: true });
    if (!updated) return res.status(404).json({ message: "Escala não encontrada." });

    return res.status(200).json({
      message: "Escala atualizada.",
      item: {
        id: String(updated._id),
        unitId: String(updated.restaurantUnit),
        startTable: updated.startTable,
        endTable: updated.endTable,
        attendantId: updated.attendant ? String(updated.attendant) : null,
        attendantName: updated.attendantName ?? null,
        label: updated.label ?? null,
        startsAt: updated.startsAt ? updated.startsAt.toISOString() : null,
        endsAt: updated.endsAt ? updated.endsAt.toISOString() : null,
        daysOfWeek: Array.isArray(updated.daysOfWeek) ? [...updated.daysOfWeek].sort((a, b) => a - b) : [],
        isActive: updated.isActive !== false,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    console.error("updateRangeAssignment error:", e);
    return res.status(500).json({ message: "Erro ao atualizar escala." });
  }
};

export const deleteRangeAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID inválido." });
    const r = await RangeAssignmentModel.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ message: "Escala não encontrada." });
    return res.status(200).json({ message: "Escala removida." });
  } catch (e) {
    console.error("deleteRangeAssignment error:", e);
    return res.status(500).json({ message: "Erro ao remover escala." });
  }
};
