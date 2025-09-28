// services/attendantResolver.ts
import { Types } from "mongoose";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { getUnitTimezone } from "../services/getUnitTimezone";
import { RangeAssignmentModel as RangeAssignment } from "../models/RangeAssignment";

type ResolveArgs = { unitId: string; tableId: number; now?: Date };

export async function resolveResponsibleAttendant({ unitId, tableId, now }: ResolveArgs) {
  const tz = await getUnitTimezone(unitId);

  const nowServer = now ?? new Date();
  const nowLocal  = toZonedTime(nowServer, tz);
  const dowLocal  = nowLocal.getDay(); // 0..6 (0=Dom)

  // Busca por mesa + dia (suporta array `tables` ou faixa `tableFrom/tableTo`)
  const candidates = await RangeAssignment.find({
    unitId: new Types.ObjectId(unitId),
    isActive: true,
    $or: [
      { tables: { $in: [tableId] } },
      { tableFrom: { $lte: tableId }, tableTo: { $gte: tableId } },
    ],
    daysOfWeek: { $in: [dowLocal, String(dowLocal)] }, // cobre number ou string
  }).lean();

  const pick = candidates.find((c: any) => {
    const [sh, sm] = String(c.startTime ?? "00:00").split(":").map(Number);
    const [eh, em] = String(c.endTime   ?? "23:59").split(":").map(Number);

    // Constroi limites no **fuso da unidade**
    const startLocal = new Date(
      nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), sh, sm, 0, 0,
    );
    let   endLocal   = new Date(
      nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), eh, em, 0, 0,
    );

    // Turno que cruza a meia-noite (ex.: 22:00–02:00)
    if (endLocal <= startLocal) {
      endLocal = new Date(endLocal.getTime() + 24 * 60 * 60 * 1000);
    }

    // Converte limites p/ UTC antes de comparar com o relógio do servidor
    const start = fromZonedTime(startLocal, tz);
    const end   = fromZonedTime(endLocal,   tz);

    return nowServer >= start && nowServer <= end;
  });

  if (!pick) return null;

  return {
    attendantId: pick.attendant?._id ? String(pick.attendant?._id) : null,
    attendantName: pick.attendantName ?? null,
    strategy: "scale" as const,
  };
}
