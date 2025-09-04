import { Request, Response } from "express";
import { RangeAssignmentModel } from "../models/rangeAssignment";
import { UserModel } from "../models/User";
import mongoose from "mongoose";

type AssignmentInput = {
  startTable: number;
  endTable: number;
  attendantId?: string;
  attendantName?: string; // <— NOVO
  label?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

const overlapsRange = (a1:number,a2:number,b1:number,b2:number) => Math.max(a1,b1) <= Math.min(a2,b2);
const overlapsTime = (aS:Date|null,aE:Date|null,bS:Date|null,bE:Date|null) => {
  const sA = aS ? aS.getTime() : -Infinity;
  const eA = aE ? aE.getTime() : +Infinity;
  const sB = bS ? bS.getTime() : -Infinity;
  const eB = bE ? bE.getTime() : +Infinity;
  return sA < eB && sB < eA;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Resolve `attendantName` OU `attendantId` para um usuário único da unidade (ATTENDANT/MANAGER)
async function resolveAttendant(unitId: string, nameOrId?: string, explicitId?: string) {
  // Prioriza id explícito
  if (explicitId && mongoose.isValidObjectId(explicitId)) {
    const byId = await UserModel.findOne({
      _id: explicitId,
      restaurantUnit: unitId,
      role: { $in: ["ATTENDANT", "MANAGER"] },
    });
    if (byId) return { user: byId, many: false };
  }

  const needle = (nameOrId || "").trim();
  if (!needle) return { user: null as any, many: false };

  // Se vier e-mail, tente match exato
  if (needle.includes("@")) {
    const byEmail = await UserModel.findOne({
      restaurantUnit: unitId,
      role: { $in: ["ATTENDANT", "MANAGER"] },
      email: needle,
    });
    if (byEmail) return { user: byEmail, many: false };
  }

  // Busca por nome (case/acentos-insensitive via collation)
  const parts = needle.split(/\s+/).filter(Boolean);
  const coll = { locale: "pt", strength: 1 as const }; // ignora acentos/maiúsculas

  let query: any;
  if (parts.length >= 2) {
    const first = escapeRegExp(parts[0]);
    const last = escapeRegExp(parts.slice(1).join(" "));
    query = {
      $or: [
        { firstName: new RegExp(`^${first}`, "i"), lastName: new RegExp(last, "i") },
        { lastName: new RegExp(`^${last}`, "i"), firstName: new RegExp(first, "i") },
      ],
    };
  } else {
    const one = escapeRegExp(needle);
    query = {
      $or: [
        { firstName: new RegExp(one, "i") },
        { lastName: new RegExp(one, "i") },
      ],
    };
  }

  const candidates = await UserModel.find({
    restaurantUnit: unitId,
    role: { $in: ["ATTENDANT", "MANAGER"] },
    ...query,
  })
    .collation(coll)
    .limit(5);

  if (candidates.length === 1) return { user: candidates[0], many: false };
  if (candidates.length === 0) return { user: null as any, many: false };

  // Ambíguo: devolve lista para o front decidir (evita atribuir errado)
  return {
    user: null as any,
    many: true,
    options: candidates.map(u => ({
      id: String(u._id),
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
      email: u.email,
    })),
  };
}

// GET público: quem atende AGORA a mesa (resolve por intervalo + janela)
export const getPublicAttendantForTable = async (req: Request, res: Response) => {
  const { unitId, tableId } = req.params as { unitId: string; tableId: string };
  const tableNum = Number(tableId);
  if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

  const now = new Date();

  const doc = await RangeAssignmentModel.findOne({
    restaurantUnit: unitId,
    isActive: true,
    startTable: { $lte: tableNum },
    endTable:   { $gte: tableNum },
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  })
  .sort({ startsAt: -1 })
  .populate({ path: "attendant", select: "firstName lastName role" });

  if (!doc) return res.json({ attendant: null, updatedAt: null });

  const a: any = doc.attendant;
  const name = a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : null;
  return res.json({ attendant: a ? { id: String(a._id), name } : null, updatedAt: doc.updatedAt });
};

// PUT (MANAGER): criar/alterar escala em LOTE por intervalos
export const putBulkRangeAssignments = async (req: Request, res: Response) => {
  const { unitId } = req.params as { unitId: string };
  const { assignments } = (req.body || {}) as { assignments: AssignmentInput[] };
  if (!Array.isArray(assignments) || !assignments.length) {
    return res.status(400).json({ message: "Envie assignments=[{startTable,endTable,attendantName?,attendantId?,startsAt?,endsAt?,label?}]." });
  }

  const now = new Date();

  try {
    for (const raw of assignments) {
      const sT = Number(raw.startTable), eT = Number(raw.endTable);
      if (Number.isNaN(sT) || Number.isNaN(eT)) continue;

      const [lo, hi] = sT <= eT ? [sT, eT] : [eT, sT];
      const startsAt = raw.startsAt ? new Date(raw.startsAt) : null;
      const endsAt   = raw.endsAt   ? new Date(raw.endsAt)   : null;

      const r = await resolveAttendant(
        unitId,
        raw.attendantName,
        raw.attendantId
      );

      if ((r as any).many) {
        return res.status(409).json({
          message: "Nome de atendente ambíguo. Selecione uma opção.",
          options: (r as any).options, // [{id,name,email}]
        });
      }
      if (!r.user) {
        return res.status(404).json({ message: `Atendente não encontrado para: "${raw.attendantName || raw.attendantId}"` });
      }

      // Fechar janelas ativas que colidem em tempo E intervalo
      const existing = await RangeAssignmentModel.find({ restaurantUnit: unitId, isActive: true });
      for (const ex of existing) {
        if (overlapsRange(lo, hi, ex.startTable, ex.endTable) &&
            overlapsTime(startsAt, endsAt, ex.startsAt ?? null, ex.endsAt ?? null)) {
          ex.isActive = false;
          await ex.save();
        }
      }

      await RangeAssignmentModel.create({
        restaurantUnit: unitId,
        startTable: lo,
        endTable: hi,
        attendant: r.user._id,
        label: raw.label ?? null,
        startsAt, endsAt,
        isActive: true,
      });
    }

    return res.status(200).json({ ok: true, updatedAt: now.toISOString() });
  } catch (e) {
    console.error("Erro ao atualizar atribuições:", e);
    return res.status(500).json({ message: "Erro ao atualizar atribuições." });
  }
};
