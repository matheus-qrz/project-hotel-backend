// src/services/attendantResolver.ts
import { Types } from "mongoose";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { HotelUnitModel } from "../models/HotelUnit";
import { RangeAssignmentModel as RangeAssignment } from "../models/RangeAssignment";
import { UserModel as User } from "../models/User";

type Args = { unitId: string; tableId: number; now?: Date };

async function getUnitTimezone(unitId: string): Promise<string> {
  const unit = await HotelUnitModel.findById(unitId).select("timezone").lean();
  return unit?.timezone || "America/Sao_Paulo"; // fallback seguro
}

function pickHM(d: Date | string | number | null | undefined) {
  if (!d) return { h: 0, m: 0 };
  const dt = new Date(d as any);
  return { h: dt.getUTCHours(), m: dt.getUTCMinutes() }; // armazena-se como UTC 1970; pegamos HH:mm
}

export async function resolveResponsibleAttendant({ unitId, tableId, now }: Args) {
  const tz = await getUnitTimezone(unitId); // ex.: "America/Sao_Paulo"

  const nowServer = now ?? new Date();
  const nowLocal  = toZonedTime(nowServer, tz);
  const dowLocal  = nowLocal.getDay(); // 0..6 (Dom=0)

  // 1) Busca candidatos da UNIDADE que cobrem a mesa e o dia
  const candidates = await RangeAssignment.find({
    unit: new Types.ObjectId(unitId),
    isActive: true,
    startTable: { $lte: tableId },
    endTable:   { $gte: tableId },
    // daysOfWeek pode ser [number] ou [string]
    $or: [{ daysOfWeek: { $in: [dowLocal] } }, { daysOfWeek: { $in: [String(dowLocal)] } }],
  })
    .lean();

  // 2) Filtra por janela de horário [start, end)
  const matches = candidates.filter((c: any) => {
    // seus docs têm startsAt/endsAt como Date 1970-01-01T(HH:mm):00.000Z
    const { h: sh, m: sm } = pickHM(c.startsAt);
    const { h: eh, m: em } = pickHM(c.endsAt);

    // constrói limites no fuso local
    const startLocal = new Date(
      nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), sh, sm, 0, 0,
    );
    let endLocal = new Date(
      nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), eh, em, 0, 0,
    );

    // turno que cruza a meia-noite (ex.: 18:00–00:00 ou 22:00–02:00)
    if (endLocal <= startLocal) {
      endLocal = new Date(endLocal.getTime() + 24 * 60 * 60 * 1000);
    }

    const start = fromZonedTime(startLocal, tz);
    const end   = fromZonedTime(endLocal,   tz);

    // janela: [start, end) => início inclusivo, fim exclusivo
    return nowServer >= start && nowServer < end;
  });

  if (matches.length === 0) return null;

  // 3) Critérios de desempate (opcional): mais recente e/ou maior startTable/endTable mais específicos
  matches.sort((a: any, b: any) => {
    // preferir quem começa mais tarde (ex.: 18:00 vence 12:00)
    const as = new Date(a.startsAt).getUTCHours() * 60 + new Date(a.startsAt).getUTCMinutes();
    const bs = new Date(b.startsAt).getUTCHours() * 60 + new Date(b.startsAt).getUTCMinutes();
    if (as !== bs) return bs - as;
    // em seguida, quem tem range de mesa mais “apertado”
    const ar = (a.endTable ?? 9999) - (a.startTable ?? 0);
    const br = (b.endTable ?? 9999) - (b.startTable ?? 0);
    if (ar !== br) return ar - br;
    // por fim, mais recente
    return (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0);
  });

  const pick = matches[0];

  let attendantName: string | null = pick.attendantName ?? null;
  if (!attendantName && pick.attendant) {
    const u = await User.findById(pick.attendant).select("name firstName lastName").lean();
    attendantName = ([u?.firstName, u?.lastName].filter(Boolean).join(" ")).trim() || null;
  }

  return {
    attendantId: pick.attendant ? String(pick.attendant) : null,
    attendantName,
    strategy: "scale" as const,
  };
}
