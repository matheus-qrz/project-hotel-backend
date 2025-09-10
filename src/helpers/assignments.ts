import { RangeAssignmentModel } from "../models/RangeAssignment";

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
