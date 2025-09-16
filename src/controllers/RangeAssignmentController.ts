import mongoose from "mongoose";
import { Request, Response } from "express";
import { RangeAssignmentModel } from "../models/RangeAssignment";
import { UserModel } from "../models/User";

/**
 * Convensão de dias da semana:
 * 0 = Domingo ... 6 = Sábado
 */
type AssignmentInput = {
  unitId?: string;                 // preferível
  restaurantId?: string | null;    // opcional (matriz), se ainda usa
  startTable: number;
  endTable: number;
  attendantId?: string;
  attendantName?: string;
  label?: string | null;
  startsAt?: string | null;        // ISO ou "HH:mm" (ver parse)
  endsAt?: string | null;          // ISO ou "HH:mm"
  daysOfWeek: number[];            // NOVO: array de dias
  isActive?: boolean;
};

const overlapsRange = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(a1, b1) <= Math.min(a2, b2);

const normalizeDays = (days?: number[]) => {
  const set = new Set<number>();
  (days || []).forEach((d) => {
    if (Number.isInteger(d) && d >= 0 && d <= 6) set.add(d);
  });
  return Array.from(set).sort((a, b) => a - b);
};

const normalizeHourStringToDate = (hour?: string | null) => {
  if (!hour) return null;
  // Aceita "HH:mm" e ISO. Guardamos como Date para manter compat com schema atual.
  // Anchor: 1970-01-01 UTC (evita dependência de fuso ao recriar Date).
  if (/^\d{1,2}:\d{2}$/.test(hour)) {
    const [h, m] = hour.split(":").map((x) => parseInt(x, 10));
    const dt = new Date(Date.UTC(1970, 0, 1, h, m, 0, 0));
    return dt;
  }
  const d = new Date(hour);
  return isNaN(d.getTime()) ? null : d;
};

const keyOf = (payload: {
  unitId?: string | null;
  restaurantId?: string | null;
  attendantId?: string | null;
  attendantName?: string | null;
  startTable: number;
  endTable: number;
  label?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}) => JSON.stringify({
  u: payload.unitId || null,
  r: payload.restaurantId || null,
  a: payload.attendantId || null,
  an: payload.attendantName || null,
  st: payload.startTable,
  et: payload.endTable,
  l: payload.label || null,
  sa: payload.startsAt ? payload.startsAt.toISOString() : null,
  ea: payload.endsAt ? payload.endsAt.toISOString() : null,
});

/**
 * Consolida duplicatas legadas (um doc por dia) em um único documento com daysOfWeek[].
 * Mantém o doc "keeper" (o mais antigo) e remove os demais.
 */
const consolidateDuplicates = async (keeperId: mongoose.Types.ObjectId) => {
  const keeper = await RangeAssignmentModel.findById(keeperId);
  if (!keeper) return;

  // Monta chave canônica do "grupo"
  const key = keyOf({
    unitId: (keeper as any).unitId ?? (keeper as any)?.meta?.unitId ?? null,
    restaurantId: (keeper as any).restaurantId ?? (keeper as any)?.meta?.restaurantId ?? null,
    attendantId: keeper.attendant ? String(keeper.attendant) : null,
    attendantName: keeper.attendantName || null,
    startTable: keeper.startTable,
    endTable: keeper.endTable,
    label: keeper.label || null,
    startsAt: keeper.startsAt || null,
    endsAt: keeper.endsAt || null,
  });

  // Busca todos os que compartilham a mesma assinatura
  const siblings = await RangeAssignmentModel.find({
    $or: [
      // match por campos explícitos
      {
        startTable: keeper.startTable,
        endTable: keeper.endTable,
        label: keeper.label || null,
        startsAt: keeper.startsAt || null,
        endsAt: keeper.endsAt || null,
        attendantId: keeper.attendant || null,
        attendantName: keeper.attendantName || null,
        $or: [
          { unitId: (keeper as any).unitId ?? null },
          { "meta.unitId": (keeper as any)?.meta?.unitId ?? null },
        ],
      },
    ],
  });

  if (!siblings.length) return;

  // Escolhe o mais antigo como "keeper"
  const sorted = siblings.sort((a: any, b: any) => {
    const at = (a.createdAt || new Date()).getTime();
    const bt = (b.createdAt || new Date()).getTime();
    return at - bt;
  });
  const realKeeper = sorted[0];
  const rest = sorted.slice(1);

  // Junta daysOfWeek e dayOfWeek (legado)
  const days = new Set<number>(
    normalizeDays(
      [
        ...(Array.isArray((realKeeper as any).daysOfWeek) ? (realKeeper as any).daysOfWeek : []),
        typeof (realKeeper as any).dayOfWeek === "number" ? (realKeeper as any).dayOfWeek : undefined,
        ...rest.flatMap((doc: any) => [
          ...(Array.isArray(doc.daysOfWeek) ? doc.daysOfWeek : []),
          typeof doc.dayOfWeek === "number" ? doc.dayOfWeek : undefined,
        ]),
      ].filter((x) => typeof x === "number") as number[]
    )
  );

  // Atualiza keeper com união dos dias
  await RangeAssignmentModel.updateOne(
    { _id: realKeeper._id },
    {
      $set: { daysOfWeek: Array.from(days), updatedAt: new Date() },
      $unset: { dayOfWeek: "" }, // remove legado se existir
    }
  );

  // Remove duplicatas extras
  const idsToDelete = rest.map((d: any) => d._id).filter((id) => String(id) !== String(realKeeper._id));
  if (idsToDelete.length) {
    await RangeAssignmentModel.deleteMany({ _id: { $in: idsToDelete } });
  }
};

/**
 * Cria/mescla um único documento por combinação chave com daysOfWeek[].
 * Se já existir, faz merge dos dias (addToSet) e consolida duplicatas legadas.
 */
export const createOrMergeRangeAssignment = async (req: Request, res: Response) => {
  try {
    const {
      unitId,
      restaurantId,
      startTable,
      endTable,
      attendantId,
      attendantName,
      label,
      startsAt,
      endsAt,
      daysOfWeek,
      isActive,
    } = (req.body || {}) as AssignmentInput;

    if (!startTable || !endTable || startTable > endTable) {
      return res.status(400).json({ message: "Faixa de mesas inválida." });
    }

    const days = normalizeDays(daysOfWeek);
    if (!days.length) {
      return res.status(400).json({ message: "Selecione ao menos um dia da semana." });
    }

    // Horários (mantemos Date para compat)
    const startsAtDate = normalizeHourStringToDate(startsAt || undefined);
    const endsAtDate = normalizeHourStringToDate(endsAt || undefined);
    if (!!startsAtDate !== !!endsAtDate) {
      return res.status(400).json({ message: "Informe horário inicial e final." });
    }
    if (startsAtDate && endsAtDate && endsAtDate <= startsAtDate) {
      return res.status(400).json({ message: "Horário final deve ser maior que o inicial." });
    }

    // Valida atendente (se id for enviado)
    let attendantNameFinal = attendantName || null;
    let attendantIdFinal: mongoose.Types.ObjectId | null = null;
    if (attendantId) {
      if (!mongoose.Types.ObjectId.isValid(attendantId)) {
        return res.status(400).json({ message: "attendantId inválido." });
      }
      const user = await UserModel.findById(attendantId);
      if (!user) return res.status(404).json({ message: "Atendente não encontrado." });
      attendantIdFinal = user._id;
      if (!attendantNameFinal) {
        attendantNameFinal = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null;
      }
    } else if (!attendantNameFinal) {
      return res.status(400).json({ message: "Informe attendantId ou attendantName." });
    }

    const matchUnit = unitId ? { unitId } : { "meta.unitId": null }; // mantém compat; ajuste se necessário
    const baseMatch = {
      ...matchUnit,
      startTable,
      endTable,
      label: label ?? null,
      startsAt: startsAtDate ?? null,
      endsAt: endsAtDate ?? null,
      attendantId: attendantIdFinal,
      attendantName: attendantNameFinal,
    };

    // Upsert: um doc por combinação
    const now = new Date();
    const updated = await RangeAssignmentModel.findOneAndUpdate(
      baseMatch,
      {
        $setOnInsert: {
          ...baseMatch,
          daysOfWeek: [],
          isActive: isActive !== false,
          createdAt: now,
          updatedAt: now,
        },
        $addToSet: { daysOfWeek: { $each: days } },
        $set: { updatedAt: now },
        $unset: { dayOfWeek: "" }, // remove legado se houver
      },
      { upsert: true, new: true }
    );

    // Consolida qualquer duplicata legado que ainda exista
    await consolidateDuplicates(updated._id as mongoose.Types.ObjectId);

    return res.status(201).json({
      message: "Escala aplicada com sucesso.",
      item: {
        id: String(updated._id),
        unitId: (updated as any).unitId ?? (updated as any)?.meta?.unitId ?? null,
        startTable: updated.startTable,
        endTable: updated.endTable,
        attendantId: updated.attendant ? String(updated.attendant._id) : null,
        attendantName: updated.attendantName ?? null,
        label: updated.label ?? null,
        startsAt: updated.startsAt ? updated.startsAt.toISOString() : null,
        endsAt: updated.endsAt ? updated.endsAt.toISOString() : null,
        daysOfWeek: normalizeDays((updated as any).daysOfWeek),
        isActive: updated.isActive !== false,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    console.error("Erro ao criar/mesclar range-assignment:", e);
    return res.status(500).json({ message: "Erro ao aplicar escala." });
  }
};

/**
 * Substitui COMPLETAMENTE o array de dias de um assignment (id exato).
 */
export const replaceDays = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { daysOfWeek } = (req.body || {}) as { daysOfWeek: number[] };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }
    const days = normalizeDays(daysOfWeek);
    if (!days.length) return res.status(400).json({ message: "Informe ao menos um dia." });

    const doc = await RangeAssignmentModel.findByIdAndUpdate(
      id,
      {
        $set: { daysOfWeek: days, updatedAt: new Date() },
        $unset: { dayOfWeek: "" },
      },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Escala não encontrada." });

    await consolidateDuplicates(doc._id as mongoose.Types.ObjectId);

    return res.status(200).json({
      message: "Dias atualizados.",
      item: {
        id: String(doc._id),
        daysOfWeek: normalizeDays((doc as any).daysOfWeek),
      },
    });
  } catch (e) {
    console.error("Erro ao substituir dias:", e);
    return res.status(500).json({ message: "Erro ao atualizar dias da escala." });
  }
};

/**
 * Liga/Desliga uma escala (id exato).
 */
export const toggleActive = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }
    const doc = await RangeAssignmentModel.findById(id);
    if (!doc) return res.status(404).json({ message: "Escala não encontrada." });

    const next = !(doc.isActive !== false);
    doc.isActive = next;
    (doc as any).updatedAt = new Date();
    await doc.save();

    return res.status(200).json({ message: next ? "Escala ativada." : "Escala desativada.", isActive: next });
  } catch (e) {
    console.error("Erro ao alternar status:", e);
    return res.status(500).json({ message: "Erro ao alternar status da escala." });
  }
};

/**
 * Lista escalas já agregando dias (compat com legado).
 * Filtros opcionais: unitId, attendantId, activeOnly
 */
export const listRangeAssignments = async (req: Request, res: Response) => {
  try {
    const { unitId, attendantId, activeOnly } = (req.query || {}) as {
      unitId?: string;
      attendantId?: string;
      activeOnly?: string;
    };

    const match: any = {};
    if (unitId) match.$or = [{ unitId }, { "meta.unitId": unitId }];
    if (attendantId && mongoose.Types.ObjectId.isValid(attendantId)) match.attendantId = new mongoose.Types.ObjectId(attendantId);
    if (activeOnly === "true") match.isActive = { $ne: false };

    // Pipeline que:
    // 1) Unifica daysOfWeek com possível dayOfWeek legado
    // 2) Agrupa por combinação chave para ter um card único
    const pipeline: any[] = [
      { $match: match },
      {
        $addFields: {
          __days: {
            $cond: [
              { $eq: [{ $type: "$daysOfWeek" }, "array"] },
              "$daysOfWeek",
              {
                $cond: [
                  { $ne: [{ $type: "$dayOfWeek" }, "missing"] },
                  ["$dayOfWeek"],
                  [],
                ],
              },
            ],
          },
        },
      },
      { $unwind: { path: "$__days", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            unitId: { $ifNull: ["$unitId", "$meta.unitId"] },
            attendantId: "$attendantId",
            attendantName: "$attendantName",
            startTable: "$startTable",
            endTable: "$endTable",
            label: "$label",
            startsAt: "$startsAt",
            endsAt: "$endsAt",
          },
          days: { $addToSet: "$__days" },
          isActive: { $max: { $cond: [{ $eq: ["$isActive", false] }, 0, 1] } },
          updatedAt: { $max: "$updatedAt" },
          anyId: { $first: "$_id" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id.attendantId",
          foreignField: "_id",
          as: "attendant",
        },
      },
      {
        $project: {
          _id: 0,
          id: "$anyId",
          unitId: "$_id.unitId",
          startTable: "$_id.startTable",
          endTable: "$_id.endTable",
          attendantId: "$_id.attendantId",
          attendantName: {
            $ifNull: [
              "$_id.attendantName",
              {
                $let: {
                  vars: { a: { $arrayElemAt: ["$attendant", 0] } },
                  in: {
                    $trim: {
                      input: {
                        $concat: [
                          { $ifNull: ["$$a.firstName", ""] },
                          " ",
                          { $ifNull: ["$$a.lastName", ""] },
                        ],
                      },
                    },
                  },
                },
              },
            ],
          },
          label: "$_id.label",
          startsAt: "$_id.startsAt",
          endsAt: "$_id.endsAt",
          daysOfWeek: {
            $setUnion: [
              {
                $filter: {
                  input: "$days",
                  as: "d",
                  cond: { $and: [{ $ne: ["$$d", null] }, { $gte: ["$$d", 0] }, { $lte: ["$$d", 6] }] },
                },
              },
              [],
            ],
          },
          isActive: { $cond: [{ $gt: ["$isActive", 0] }, true, false] },
          updatedAt: 1,
        },
      },
      { $sort: { "attendantName": 1, "startTable": 1, "label": 1 } },
    ];

    const itemsRaw = await RangeAssignmentModel.aggregate(pipeline);
    const items = itemsRaw.map((d: any) => ({
      id: String(d.id),
      unitId: d.unitId ?? null,
      startTable: d.startTable,
      endTable: d.endTable,
      attendantId: d.attendantId ? String(d.attendantId) : null,
      attendantName: d.attendantName || null,
      label: d.label ?? null,
      startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : null,
      endsAt: d.endsAt ? new Date(d.endsAt).toISOString() : null,
      daysOfWeek: (Array.isArray(d.daysOfWeek) ? d.daysOfWeek : []).sort((a: number, b: number) => a - b),
      updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
      isActive: d.isActive !== false,
    }));

    return res.status(200).json({ items, count: items.length });
  } catch (e) {
    console.error("Erro ao listar range-assignments:", e);
    return res.status(500).json({ message: "Erro ao listar escalas." });
  }
};

/**
 * Remove (hard delete) pelo id exato.
 */
export const deleteRangeAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }
    const r = await RangeAssignmentModel.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ message: "Escala não encontrada." });
    return res.status(200).json({ message: "Escala removida." });
  } catch (e) {
    console.error("Erro ao remover escala:", e);
    return res.status(500).json({ message: "Erro ao remover escala." });
  }
};

/**
 * Atualiza campos básicos (sem substituir os dias).
 */
export const updateRangeAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }

    const {
      startTable,
      endTable,
      attendantId,
      attendantName,
      label,
      startsAt,
      endsAt,
      isActive,
    } = (req.body || {}) as Partial<AssignmentInput>;

    const payload: any = {};
    if (typeof startTable === "number") payload.startTable = startTable;
    if (typeof endTable === "number") payload.endTable = endTable;
    if (typeof label !== "undefined") payload.label = label ?? null;
    if (typeof isActive !== "undefined") payload.isActive = !!isActive;

    if (typeof attendantName !== "undefined") payload.attendantName = attendantName || null;
    if (typeof attendantId !== "undefined") {
      if (attendantId) {
        if (!mongoose.Types.ObjectId.isValid(attendantId)) {
          return res.status(400).json({ message: "attendantId inválido." });
        }
        payload.attendantId = new mongoose.Types.ObjectId(attendantId);
      } else {
        payload.attendantId = null;
      }
    }

    if (typeof startsAt !== "undefined" || typeof endsAt !== "undefined") {
      const sa = normalizeHourStringToDate(startsAt || undefined);
      const ea = normalizeHourStringToDate(endsAt || undefined);
      if (!!sa !== !!ea) return res.status(400).json({ message: "Informe horário inicial e final." });
      if (sa && ea && ea <= sa) return res.status(400).json({ message: "Horário final deve ser maior que o inicial." });
      payload.startsAt = sa ?? null;
      payload.endsAt = ea ?? null;
    }

    payload.updatedAt = new Date();

    const updated = await RangeAssignmentModel.findByIdAndUpdate(id, { $set: payload }, { new: true });
    if (!updated) return res.status(404).json({ message: "Escala não encontrada." });

    await consolidateDuplicates(updated._id as mongoose.Types.ObjectId);

    return res.status(200).json({
      message: "Escala atualizada.",
      item: {
        id: String(updated._id),
        startTable: updated.startTable,
        endTable: updated.endTable,
        attendantId: updated.attendant,
        attendantName: updated.attendantName ?? null,
        label: updated.label ?? null,
        startsAt: updated.startsAt ? updated.startsAt.toISOString() : null,
        endsAt: updated.endsAt ? updated.endsAt.toISOString() : null,
        daysOfWeek: normalizeDays((updated as any).daysOfWeek),
        isActive: updated.isActive !== false,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    console.error("Erro ao atualizar escala:", e);
    return res.status(500).json({ message: "Erro ao atualizar escala." });
  }
};
