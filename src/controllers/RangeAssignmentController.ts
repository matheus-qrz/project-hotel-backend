// src/controllers/RangeAssignmentController.ts (revisado)
import mongoose, { Types } from "mongoose";
import { Request, Response } from "express";
import { RangeAssignmentModel } from "../models/RangeAssignment";
import { TableAssignmentModel } from "../models/TableAssignment";
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
  const d = new Date(t as any);
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

const asHHmm = (s: unknown) => (typeof s === "string" && /^\d{2}:\d{2}$/.test(s) ? s : null);

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const nowRefTime = () => {
  const now = new Date();
  return parseHHmmToDate(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`)!;
};

/** =========================
 *  CRIAR / MESCLAR (upsert)
 *  ========================= */
export const createOrMergeRangeAssignment = async (req: Request, res: Response) => {
  try {
    // 1) Param
    const unitId = String((req.params as any).unitId ?? (req.params as any).id ?? "").trim();
    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return res.status(400).json({ message: "ID da unidade inválido." });
    }

    const unit = await RestaurantUnitModel.findById(unitId);
    if (!unit) return res.status(404).json({ message: "Unidade não encontrada." });

    // 2) Body safe-parse
    const startTable = req.body.startTable;
    const endTable = req.body.endTable;
    const daysOfWeek = Array.isArray(req.body.daysOfWeek) ? req.body.daysOfWeek : [];
    const startsAtStr = asHHmm(req.body.startsAt);
    const endsAtStr = asHHmm(req.body.endsAt);
    const attendantId: string | null =
      req.body.attendantId && String(req.body.attendantId) !== "" ? String(req.body.attendantId) : null;
    const attendantName: string | null =
      req.body.attendantName ? String(req.body.attendantName) : null;
    const label: string | null = req.body.label ? String(req.body.label) : null;

    if (!Number.isInteger(startTable) || !Number.isInteger(endTable) || startTable > endTable) {
      return res.status(400).json({ message: "Faixa de mesas inválida." });
    }
    if (!startsAtStr || !endsAtStr) {
      return res.status(400).json({ message: "Horários devem estar no formato HH:mm." });
    }
    // valida dias 0..6
    const dowOk = daysOfWeek.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!dowOk) {
      return res.status(400).json({ message: "daysOfWeek deve conter inteiros entre 0 e 6." });
    }

    // 3) Converte horas
    const startsAt = parseHHmmToDate(startsAtStr);
    const endsAt = parseHHmmToDate(endsAtStr);

    // 4) (Opcional) valida atendente
    let attendant: Types.ObjectId | null = null;
    if (attendantId) {
      const user = await UserModel.findById(attendantId).select("_id");
      if (!user) {
        return res.status(422).json({ message: "Atendente não encontrado." });
      }
      attendant = user._id as Types.ObjectId;
    }

    // 5) Upsert idempotente por (unit, attendant, faixa, hora)
    const baseQuery = {
      restaurantUnit: unit._id,
      attendant, // pode ser null
      startTable,
      endTable,
      startsAt,
      endsAt,
    } as const;

    const existing = await RangeAssignmentModel.findOne(baseQuery);
    if (existing) {
      const set = new Set([...(existing.daysOfWeek || []), ...daysOfWeek]);
      existing.daysOfWeek = Array.from(set).sort();
      if (attendantName) existing.attendantName = attendantName;
      if (label !== null) existing.label = label;
      await existing.save();
      return res.status(200).json(existing);
    }

    const created = await RangeAssignmentModel.create({
      ...baseQuery,
      restaurant: unit.restaurant ?? null,
      attendantName,
      label,
      daysOfWeek,
      isActive: true,
    });

    return res.status(201).json(created);
  } catch (err: any) {
    // mapeia erros comuns para evitar 500 genérico
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    if (err?.name === "CastError") {
      return res.status(400).json({ message: `Campo inválido: ${err?.path}` });
    }
    if (err?.code === 11000) {
      // duplicata exata pelo índice único
      return res.status(409).json({ message: "Já existe uma escala idêntica ativa." });
    }
    console.error("[range-assignments] erro inesperado:", {
      name: err?.name,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({ message: "Erro interno ao aplicar escala." });
  }
};

/** =========================
 *  LISTAR (agregado, compat)
 *  ========================= */
export const listRangeAssignments = async (req: Request, res: Response) => {
  const { unitId } = req.params as any;
  try {
    const { attendantId, activeOnly } = (req.query || {}) as any;
    const match: any = {};
    if (unitId && Types.ObjectId.isValid(unitId)) {
      match.restaurantUnit = new Types.ObjectId(unitId);
    }
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

/** =========================
 *  RESOLVER GARÇOM DA MESA (ATIVO) – usa TableAssignment e cai no plano (Range)
 *  ========================= */
export const getAssignedAttendantController = async (req: Request, res: Response) => {
  try {
    const { unitId, tableId } = req.params as any;
    if (!Types.ObjectId.isValid(unitId)) return res.status(400).json({ message: "unitId inválido." });
    const tableNum = Number(tableId);
    if (!Number.isInteger(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    // ===== contexto: at (ISO) e tz (IANA) =====
    const atIso = String((req.query as any).at || new Date().toISOString());
    const tz = String((req.query as any).tz || "America/Sao_Paulo");
    const at = new Date(atIso);

    // HH:mm no fuso da unidade
    const hhmmInTZ = (d: Date, tz: string) => {
      const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
      const hh = parts.find(p => p.type === "hour")?.value ?? "00";
      const mm = parts.find(p => p.type === "minute")?.value ?? "00";
      return `${hh}:${mm}`;
    };
    const nowHHmm = hhmmInTZ(at, tz);

    // Lê âncoras 1970 como HH:mm em UTC (não desloca)
    const hhmmFromAnchor = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    };

    // janela [start, end) cobrindo virada
    const within = (nowHHmm: string, start: string, end: string) =>
      start <= end ? (nowHHmm >= start && nowHHmm < end) : (nowHHmm >= start || nowHHmm < end);

    // 1) candidatos por mesa + dia da semana
    const dowShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
    const dowMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const dowNum = dowMap[dowShort] ?? at.getDay();

    const ranges = await RangeAssignmentModel.find({
      restaurantUnit: unitId,
      startTable: { $lte: tableNum },
      endTable: { $gte: tableNum },
      isActive: { $ne: false },
      $or: [{ daysOfWeek: { $exists: false } }, { daysOfWeek: { $size: 0 } }, { daysOfWeek: dowNum }],
      startsAt: { $ne: null },
      endsAt: { $ne: null },
    })
      .select("attendant attendantName startTable endTable startsAt endsAt updatedAt")
      .lean();

    // 2) filtra por horário atual (considera virada)
    const valid = ranges
      .map(r => {
        const start = hhmmFromAnchor(String(r.startsAt));
        const end   = hhmmFromAnchor(String(r.endsAt));
        return within(nowHHmm, start, end) ? { r, start } : null;
      })
      .filter(Boolean) as Array<{ r: any; start: string }>;

    // 3) melhor encaixe: menor faixa (mais específica), depois quem começou mais tarde
    const best = valid
      .sort((a, b) => {
        const wa = a.r.endTable - a.r.startTable;
        const wb = b.r.endTable - b.r.startTable;
        if (wa !== wb) return wa - wb;
        return a.start < b.start ? 1 : -1; // start mais tarde primeiro
      })[0]?.r;

    // 4) override por TableAssignment APENAS se muito recente (ex.: ação manual do gerente)
    const active = await TableAssignmentModel
      .findOne({ restaurantUnit: unitId, tableId: tableNum, isActive: true })
      .populate({ path: "attendant", select: "firstName lastName avatar role" });

    const recentOverrideHrs = 8; // ajuste se quiser
    const isRecent = active?.updatedAt
      ? (Date.now() - new Date(active.updatedAt).getTime()) <= recentOverrideHrs * 3600_000
      : false;

    if (active && isRecent) {
      const a: any = active.attendant;
      const name = a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : null;
      return res.status(200).json({
        source: "table",
        attendant: a ? { id: String(a._id), name, avatar: a.avatar ?? null } : null,
        updatedAt: active.updatedAt ? active.updatedAt.toISOString() : null,
      });
    }

    // 5) retorna a escala vigente
    if (best) {
      if (best.attendant) {
        const u = await UserModel.findById(best.attendant).select("firstName lastName avatar");
        const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : (best.attendantName ?? null);
        return res.status(200).json({
          source: "range",
          attendant: { id: String(best.attendant), name, avatar: u?.avatar ?? null },
          updatedAt: best.updatedAt ? new Date(best.updatedAt).toISOString() : null,
        });
      }
      if (best.attendantName) {
        return res.status(200).json({
          source: "range",
          attendant: { id: null as any, name: best.attendantName, avatar: null },
          updatedAt: best.updatedAt ? new Date(best.updatedAt).toISOString() : null,
        });
      }
    }

    // 6) sem escala e sem override recente
    return res.status(200).json({ source: "none", attendant: null, updatedAt: null });
  } catch (e) {
    console.error("getAssignedAttendantController error:", e);
    return res.status(500).json({ message: "Erro ao resolver atendente." });
  }
};

/** =========================
 *  REASSIGN (MANAGER) – aplica atribuição temporária via TableAssignment
 *  ========================= */
export const reassignTablesController = async (req: Request, res: Response) => {
  try {
    const { tableIds, toAttendantId, unitId } = (req.body || {}) as { tableIds: number[]; toAttendantId: string; unitId: string };

    if (!Types.ObjectId.isValid(unitId)) return res.status(400).json({ message: "unitId inválido." });
    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      return res.status(400).json({ message: "Selecione ao menos uma mesa." });
    }
    if (!Types.ObjectId.isValid(toAttendantId)) {
      return res.status(400).json({ message: "toAttendantId inválido." });
    }

    const now = new Date();
    const tableNums = tableIds.map((t) => Number(t)).filter((n) => Number.isInteger(n));

    // 1) encerra ativos atuais dessas mesas
    await TableAssignmentModel.updateMany(
      { restaurantUnit: unitId, tableId: { $in: tableNums }, isActive: true },
      { $set: { isActive: false, releasedAt: now } }
    );

    // 2) sobe novos ativos (upsert por mesa)
    const ops = tableNums.map((tableId) => ({
      updateOne: {
        filter: { restaurantUnit: unitId, tableId, isActive: true },
        update: {
          $setOnInsert: {
            restaurantUnit: unitId,
            tableId,
            attendant: new Types.ObjectId(toAttendantId),
            assignedAt: now,
            isActive: true,
          },
        },
        upsert: true,
      },
    }));

    if (ops.length) await TableAssignmentModel.bulkWrite(ops);

    return res.status(200).json({ ok: true, updatedAt: now.toISOString(), tables: tableNums.length });
  } catch (e) {
    console.error("reassignTablesController error:", e);
    return res.status(500).json({ message: "Erro ao reatribuir mesas." });
  }
};
