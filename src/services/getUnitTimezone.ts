import { RestaurantUnitModel as RestaurantUnit } from "../models/RestaurantUnit";

export async function getUnitTimezone(unitId: string): Promise<string> {
  const unit = await RestaurantUnit.findById(unitId).select("timezone").lean();
  return unit?.timezone || "America/Sao_Paulo"; // fallback seguro
}