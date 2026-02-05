// utils/resolveRestaurant.ts
import { RestaurantModel } from "../models/Restaurant";
import { RestaurantUnitModel as UnitModel } from "../models/RestaurantUnit"; 
import { Types } from "mongoose";

type ResolvedCtx = {
  restaurantId: string | null;
  restaurantName: string | null;
  unitId: string | null;
};

export async function resolveRestaurantForUser(user: any): Promise<ResolvedCtx> {
  let restaurantId: string | null = null;
  let restaurantName: string | null = null;
  let unitId: string | null = null;

  // 1) ADMIN: normalmente tem o restaurantId direto
  if (user.role === "ADMIN" && user.restaurantId) {
    const r = await RestaurantModel.findById(user.restaurantId).select("_id name");
    if (r) { restaurantId = String(r._id); restaurantName = r.name; }
  }

  // 2) MANAGER / ATTENDANT: muitas vezes vêm via unit
  if (!restaurantId && user.restaurantUnit) {
    const u = await UnitModel.findById(user.restaurantUnit).select("_id restaurant");
    if (u?.restaurant) {
      const rId = (u.restaurant as Types.ObjectId).toString?.() ?? String(u.restaurant);
      const r = await RestaurantModel.findById(rId).select("_id name");
      if (r) {
        restaurantId = String(r._id);
        restaurantName = r.name;
        unitId = String(u._id);
      }
    }
  }

  // 3) fallback: se o próprio usuário tem um campo reference (ex.: user.restaurant)
  if (!restaurantId && user.restaurant) {
    const r = await RestaurantModel.findById(user.restaurant).select("_id name");
    if (r) { restaurantId = String(r._id); restaurantName = r.name; }
  }

  return { restaurantId, restaurantName, unitId };
}
