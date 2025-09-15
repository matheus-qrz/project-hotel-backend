import mongoose from "mongoose";
import { Request, Response } from "express";
import { RangeAssignmentModel } from "../models/RangeAssignment";
import { UserModel } from "../models/User";

type AssignmentInput = {
  startTable: number;
  endTable: number;
  attendantId?: string;     
  attendantName?: string;   
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

// Resolve SOMENTE usuários com role ATTENDANT na unidade
async function resolveAttendant(unitId: string, name?: string, explicitId?: string) {
  if (explicitId && mongoose.isValidObjectId(explicitId)) {
    const byId = await UserModel.findOne({ _id: explicitId, restaurantUnit: unitId, role: "ATTENDANT" });
    if (byId) return { user: byId, many: false };
  }

  const needle = (name || "").trim();
  if (!needle) return { user: null as any, many: false };

  if (needle.includes("@")) {
    const byEmail = await UserModel.findOne({ restaurantUnit: unitId, role: "ATTENDANT", email: needle });
    if (byEmail) return { user: byEmail, many: false };
  }

  const parts = needle.split(/\s+/).filter(Boolean);
  const coll = { locale: "pt", strength: 1 as const };

  let query: any;
  if (parts.length >= 2) {
    const first = escapeRegExp(parts[0]);
    const last = escapeRegExp(parts.slice(1).join(" "));
    query = { $or: [
      { firstName: new RegExp(`^${first}`, "i"), lastName: new RegExp(last, "i") },
      { lastName:  new RegExp(`^${last}`, "i"),  firstName: new RegExp(first, "i") },
    ]};
  } else {
    const one = escapeRegExp(needle);
    query = { $or: [{ firstName: new RegExp(one, "i") }, { lastName: new RegExp(one, "i") }] };
  }

  const candidates = await UserModel.find({ restaurantUnit: unitId, role: "ATTENDANT", ...query })
    .collation(coll).limit(5);

  if (candidates.length === 1) return { user: candidates[0], many: false };
  if (candidates.length === 0) return { user: null as any, many: false };

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

// GET público: quem ATENDE (agora) a mesa pelo intervalo/turno
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
      { $or: [{ endsAt: null },   { endsAt: { $gt: now } }] },
    ],
  }).sort({ startsAt: -1 })
    .populate({ path: "attendant", select: "firstName lastName role" });

  if (!doc) return res.json({ attendant: null, updatedAt: null });

  const m: any = doc.attendant;
  const name = m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() : null;
  return res.json({ attendant: m ? { id: String(m._id), name } : null, updatedAt: doc.updatedAt });
};

// PATCH (attendant): criar/alterar escala em LOTE por intervalos
export const putBulkRangeAssignments = async (req: Request, res: Response) => {
  const { restaurantId, unitId } = req.params as { restaurantId?: string; unitId?: string };
  const parent: any = unitId ? { restaurantUnit: unitId } : restaurantId ? { restaurant: restaurantId } : null;
  if (!parent) return res.status(400).json({ message: "Faltou restaurantId ou unitId" });

  const items = (req.body?.items || []) as Array<{
    startTable: number; endTable: number; startsAt: string; endsAt: string;
    attendantId?: string; attendantName?: string; label?: string | null;
  }>;

  // upsert por janela/intervalo (idempotência)
  const ops = items.map(i => ({
    updateOne: {
      filter: { ...parent, startTable: i.startTable, endTable: i.endTable, startsAt: new Date(i.startsAt), endsAt: new Date(i.endsAt) },
      update: {
        $set: {
          ...parent,
          startTable: i.startTable, endTable: i.endTable,
          startsAt: new Date(i.startsAt), endsAt: new Date(i.endsAt),
          label: i.label ?? null, isActive: true,
          attendant: i.attendantId ?? undefined,
          attendantName: i.attendantName ?? undefined,
        }
      },
      upsert: true
    }
  }));

  await RangeAssignmentModel.bulkWrite(ops);
  return res.status(200).json({ ok: true, upserts: ops.length });
};


export const listRangeAssignments = async (req: Request, res: Response) => {
  try {
    const { restaurantId, unitId } = req.params as { restaurantId?: string; unitId?: string };
    const scope = String(req.query.scope ?? "all"); // "all" | "current" | "upcoming"
    const now = new Date();

    const q: any = { isActive: true };
    if (unitId) q.restaurantUnit = unitId;
    else if (restaurantId) q.restaurant = restaurantId;
    else return res.status(400).json({ message: "Faltou restaurantId ou unitId" });

    if (scope === "current") { q.startsAt = { $lte: now }; q.endsAt = { $gte: now }; }
    else if (scope === "upcoming") { q.endsAt = { $gte: now }; }

    const docs = await RangeAssignmentModel.find(q)
      .populate({ path: "attendant", select: "firstName lastName" })
      .sort({ startsAt: 1, endTable: 1, startTable: 1 });

    const items = docs.map(d => ({
      _id: d._id,
      startTable: d.startTable,
      endTable: d.endTable,
      attendantId: d.attendant ? (d.attendant as any)._id : undefined,
      attendantName: d.attendant ? `${(d.attendant as any).firstName ?? ""} ${(d.attendant as any).lastName ?? ""}`.trim() || null : null,
      label: d.label ?? null,
      startsAt: d.startsAt?.toISOString() ?? null,
      endsAt: d.endsAt?.toISOString() ?? null,
      updatedAt: d.updatedAt?.toISOString() ?? null,
      isActive: d.isActive,
    }));

    return res.status(200).json({ items, count: items.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erro ao listar escalas." });
  }
};
