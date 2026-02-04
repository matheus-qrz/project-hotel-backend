import { HotelUnitModel as HotelUnit } from "../models/HotelUnit";

export async function getUnitTimezone(unitId: string): Promise<string> {
  const unit = await HotelUnit.findById(unitId).select("timezone").lean();
  return unit?.timezone || "America/Sao_Paulo"; // fallback seguro
}