import { Request, Response } from "express";
import { Types } from "mongoose";
import { DateTime } from "luxon";

import { TableAssignmentModel } from "../models/TableAssignment";
import { RangeAssignmentModel } from "../models/RangeAssignment";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import { UserModel } from "../models/User";

// ========= Helpers =========
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const toHHmm = (d: Date) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
const timeRefFromTZ = (tz: string) => {
  const now = DateTime.now().setZone(tz);
  const d = new Date(0);
  d.setUTCHours(now.hour, now.minute, 0, 0);
  const dow0Sun = now.weekday % 7; // luxon: 1=Mon..7=Sun -> 0..6
  return { timeRef: d, dow: dow0Sun };
};

const isWithinShiftHHmm = (timeHHmm: string, startHHmm: string | null, endHHmm: string | null) => {
  if (!startHHmm || !endHHmm) return true;
  // overnight (ex.: 22:00 -> 02:00)
  if (endHHmm < startHHmm) return timeHHmm >= startHHmm || timeHHmm <= endHHmm;
  return timeHHmm >= startHHmm && timeHHmm <= endHHmm;
};

const hhmmFromDateField = (t?: Date | null) => (t ? toHHmm(t) : null);

// ========= 1) Público (Guest) =========
// Se você preferir não duplicar lógica, pode mapear a rota pública diretamente
// para RangeAssignmentController.getAssignedAttendantController. Porém, para manter
// este arquivo autocontido, deixo a resolução local (TableAssignment -> Range fallback).
export const getPublicAttendantForTable = async (req: Request, res: Response) => {
  const { unitId, tableId } = req.params as { unitId: string; tableId: string };
  try {
    if (!Types.ObjectId.isValid(unitId)) return res.status(400).json({ message: "unitId inválido." });
    const tableNum = Number(tableId);
    if (!Number.isInteger(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    // 1) Primeiro: TableAssignment ativo (tempo real)
    const active = await TableAssignmentModel
      .findOne({ restaurantUnit: unitId, tableId: tableNum, isActive: true })
      .populate({ path: "attendant", select: "firstName lastName avatar role" })
      .lean();

    if (active?.attendant) {
      const a: any = active.attendant;
      const name = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
      return res.json({ source: "table", attendant: { id: String(a._id), name, avatar: a.avatar ?? null }, updatedAt: active.updatedAt ?? null });
    }

    // 2) Fallback: plano (RangeAssignment) por dia/hora da unidade
    const unit = await RestaurantUnitModel.findById(unitId).select("timezone name").lean();
    const tz = unit?.timezone || "America/Sao_Paulo";
    const { timeRef, dow } = timeRefFromTZ(String(tz));
    const timeHHmm = toHHmm(timeRef);

    const ranges = await RangeAssignmentModel.find({
      restaurantUnit: unitId,
      startTable: { $lte: tableNum },
      endTable: { $gte: tableNum },
      isActive: { $ne: false },
      $or: [ { daysOfWeek: { $size: 0 } }, { daysOfWeek: dow } ],
    }).select("attendant attendantName startTable endTable startsAt endsAt updatedAt").lean();

    const valid = ranges.filter(r => isWithinShiftHHmm(
      timeHHmm,
      hhmmFromDateField(r.startsAt),
      hhmmFromDateField(r.endsAt)
    ));

    if (!valid.length) return res.json({ source: "range", attendant: null, updatedAt: null });

    valid.sort((a: any, b: any) => {
      const wa = (a.endTable - a.startTable);
      const wb = (b.endTable - b.startTable);
      if (wa !== wb) return wa - wb;
      const ua = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const ub = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return ub - ua;
    });

    const best = valid[0];
    if (best.attendant) {
      const u = await UserModel.findById(best.attendant).select("firstName lastName avatar");
      const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : (best as any).attendantName ?? null;
      return res.json({ source: "range", attendant: { id: String(best.attendant), name, avatar: u?.avatar ?? null }, updatedAt: best.updatedAt ?? null });
    }

    return res.json({ source: "range", attendant: best.attendantName ? { id: null as any, name: best.attendantName, avatar: null } : null, updatedAt: best.updatedAt ?? null });
  } catch (e) {
    console.error("getPublicAttendantForTable error", e);
    return res.status(500).json({ message: "Erro ao resolver garçom." });
  }
};

// PUT (ATTENDANT): atribuição em lote por mesa
export const putBulkTableAssignments = async (req: Request, res: Response) => {
  const { unitId } = req.params as { unitId: string };
  const { assignments } = (req.body || {}) as {
    assignments: { tableId: number; attendantId: string }[];
  };

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ message: "Informe assignments=[{tableId, attendantId}]." });
  }

  const now = new Date();

  try {
    // Finaliza quaisquer ativos dessas mesas
    const tableIds = assignments.map(a => Number(a.tableId)).filter(n => !Number.isNaN(n));
    await TableAssignmentModel.updateMany(
      { restaurantUnit: unitId, tableId: { $in: tableIds }, isActive: true },
      { $set: { isActive: false, releasedAt: now } }
    );

    // Sobe os novos ativos
    const ops = assignments.map(({ tableId, attendantId }) => ({
      updateOne: {
        filter: { restaurantUnit: unitId, tableId: Number(tableId), isActive: true },
        update: {
          $setOnInsert: {
            restaurantUnit: unitId,
            tableId: Number(tableId),
            attendant: attendantId,
            assignedAt: now,
            isActive: true,
          },
        },
        upsert: true,
      },
    }));

    await TableAssignmentModel.bulkWrite(ops);
    return res.status(200).json({ ok: true, updatedAt: now.toISOString() });
  } catch (e) {
    console.error("Erro no bulk de atribuições:", e);
    return res.status(500).json({ message: "Erro ao atualizar atribuições." });
  }
};

// ========= 2) Seed: materializar plano em TableAssignment =========
// POST /manager/units/:unitId/seed-table-assignments?replace=true
export const seedTableAssignmentsFromRanges = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params as { unitId: string };
    const replace = String(req.query.replace || "false").toLowerCase() === "true";
    if (!Types.ObjectId.isValid(unitId)) return res.status(400).json({ message: "unitId inválido." });

    const unit = await RestaurantUnitModel.findById(unitId).select("timezone totalTables name").lean();
    if (!unit) return res.status(404).json({ message: "Unidade não encontrada." });

    const tz = (unit as any).timezone || "America/Sao_Paulo";
    const { timeRef, dow } = timeRefFromTZ(tz);
    const timeHHmm = toHHmm(timeRef);

    // 1) Coleta ranges válidos agora (dia + hora)
    const ranges = await RangeAssignmentModel.find({
      restaurantUnit: unitId,
      isActive: { $ne: false },
      $or: [ { daysOfWeek: { $size: 0 } }, { daysOfWeek: dow } ],
    }).select("attendant startTable endTable startsAt endsAt updatedAt").lean();

    const valid = ranges.filter(r => isWithinShiftHHmm(timeHHmm, hhmmFromDateField(r.startsAt), hhmmFromDateField(r.endsAt)));

    // 2) Escolhe melhor assignment por mesa (menor faixa vence; empate -> mais recente)
    type Candidate = { attendant: Types.ObjectId | null; width: number; updatedAt: number };
    const pick: Map<number, Candidate> = new Map();

    for (const r of valid) {
      if (!Number.isInteger(r.startTable) || !Number.isInteger(r.endTable)) continue;
      const width = r.endTable - r.startTable;
      const upd = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
      for (let t = r.startTable; t <= r.endTable; t++) {
        const cur = pick.get(t);
        if (!cur || width < cur.width || (width === cur.width && upd > cur.updatedAt)) {
          pick.set(t, { attendant: (r as any).attendant || null, width, updatedAt: upd });
        }
      }
    }

    const targetTables = Array.from(pick.keys());
    const now = new Date();

    // 3) Se replace=true, encerra assignments ativos dessas mesas
    let deactivated = 0;
    if (replace && targetTables.length) {
      const r = await TableAssignmentModel.updateMany(
        { restaurantUnit: unitId, tableId: { $in: targetTables }, isActive: true },
        { $set: { isActive: false, releasedAt: now } }
      );
      deactivated = (r.modifiedCount || 0);
    }

    // 4) Evita conflito: carrega ativos restantes para ignorar mesas já em uso quando replace=false
    let existingActive: Set<number> = new Set();
    if (!replace && targetTables.length) {
      const actives = await TableAssignmentModel.find({ restaurantUnit: unitId, tableId: { $in: targetTables }, isActive: true })
        .select("tableId").lean();
      existingActive = new Set(actives.map(a => a.tableId));
    }

    // 5) Upserts
    const ops = [] as any[];
    for (const t of targetTables) {
      if (!replace && existingActive.has(t)) continue;
      const cand = pick.get(t)!;
      if (!cand.attendant) continue; // sem attendant definido nesse range
      ops.push({
        updateOne: {
          filter: { restaurantUnit: unitId, tableId: t, isActive: true },
          update: {
            $setOnInsert: {
              restaurantUnit: new Types.ObjectId(unitId),
              tableId: t,
              attendant: cand.attendant,
              assignedAt: now,
              isActive: true,
            },
          },
          upsert: true,
        }
      });
    }

    const bulk = ops.length ? await TableAssignmentModel.bulkWrite(ops) : null;
    const upserts = bulk?.upsertedCount || 0;

    return res.json({
      ok: true,
      unitId,
      timezone: tz,
      replace,
      deactivated,
      created: upserts,
      consideredTables: targetTables.length,
    });
  } catch (e) {
    console.error("seedTableAssignmentsFromRanges error", e);
    return res.status(500).json({ message: "Erro ao materializar assignments." });
  }
};


