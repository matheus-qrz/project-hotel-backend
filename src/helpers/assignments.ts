import { RangeAssignmentModel } from "../models/RangeAssignment";
import { TableAssignmentModel } from "../models/TableAssignment";

export async function isAttendantAssigned(opts: {
  unitId: string;
  attendantId: string;
  tableId: number;
}) {
  const { unitId, attendantId, tableId } = opts;
  const now = new Date();
  const exists = await RangeAssignmentModel.exists({
    restaurantUnit: unitId,
    attendant: attendantId,
    isActive: true,
    startTable: { $lte: tableId },
    endTable:   { $gte: tableId },
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null },   { endsAt:   { $gt:  now } }] },
    ],
  });
  return !!exists;
}


// export async function resolveResponsibleAttendant(
//   unitId: string,
//   tableId: number,
//   atISO: string
// ): Promise<{ attendantId?: string; attendantName?: string }> {
//   const at = new Date(atISO);

//   // 1) Override por mesa (seu modelo pode ter campos diferentes; ajuste os nomes)
//   const t = await TableAssignmentModel.findOne({
//     unitId,
//     tableId,
//     startAt: { $lte: at },
//     endAt: { $gte: at },
//     isActive: true,
//   })
//     .sort({ startAt: -1 })
//     .lean();

//   if (t?._id) {
//     return { attendantId: String(t._id), attendantName: t. ?? t.attendant?.name };
//   }

//   // 2) Escala por faixa de mesas/horário
//   const r = await RangeAssignmentModel.findOne({
//     unitId,
//     startAt: { $lte: at },
//     endAt: { $gte: at },
//     tableRangeStart: { $lte: tableId },
//     tableRangeEnd: { $gte: tableId },
//     isActive: true,
//   })
//     .sort({ startAt: -1 })
//     .lean();

//   if (r?.attendantId) {
//     return { attendantId: String(r.attendantId), attendantName: r.attendantName ?? r.attendant?.name };
//   }

//   return {};
// }