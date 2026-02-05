export async function isTableInCurrentRange({ unitId, attendantId, tableId }: { unitId: string; attendantId: string; tableId: number; }) {
  const { HotelUnitModel } = await import("../models/HotelUnit");
  const unit = await HotelUnitModel.findById(unitId).select("timezone").lean();
  const tz = unit?.timezone || "America/Sao_Paulo";

  const { DateTime } = await import("luxon");
  const now = DateTime.now().setZone(tz);
  const dow = now.weekday % 7;
  const hhmmNow = `${String(now.hour).padStart(2,"0")}:${String(now.minute).padStart(2,"0")}`;

  const toHHmm = (d?: Date | null) =>
    !d ? null : `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
  const toMinutes = (s: string) => s.split(":").map(Number).reduce((h, m) => h*60+m);
  const inShift = (cur: string, start?: string | null, end?: string | null) => {
    if (!start || !end) return false;
    const c = toMinutes(cur), s = toMinutes(start), e = toMinutes(end);
    return e > s ? c >= s && c < e : c >= s || c < e;
  };

  const { RangeAssignmentModel } = await import("../models/RangeAssignment");

  const ranges = await RangeAssignmentModel.find({
    hotelUnit: unitId,
    attendant: attendantId,
    isActive: { $ne: false },
    $or: [{ daysOfWeek: { $size: 0 } }, { daysOfWeek: dow }, { daysOfWeek: String(dow) }],
  }).select("startTable endTable startsAt endsAt").lean();

  return ranges.some(r => {
    const start = toHHmm(r.startsAt), end = toHHmm(r.endsAt);
    if (!inShift(hhmmNow, start, end)) return false;
    const s = Number(r.startTable), e = Number(r.endTable);
    return Number.isInteger(s) && Number.isInteger(e) && s <= tableId && tableId <= e;
  });
}
