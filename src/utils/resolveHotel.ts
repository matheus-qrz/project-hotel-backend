// utils/resolveHotel.ts
import { HotelModel } from "../models/Hotel";
import { HotelUnitModel as UnitModel } from "../models/HotelUnit";
import { Types } from "mongoose";

type ResolvedCtx = {
  hotelId: string | null;
  hotelName: string | null;
  unitId: string | null;
};

export async function resolveHotelForUser(user: any): Promise<ResolvedCtx> {
  let hotelId: string | null = null;
  let hotelName: string | null = null;
  let unitId: string | null = null;

  // 1) ADMIN: normalmente tem o hotelId direto
  if (user.role === "ADMIN" && user.hotelId) {
    const h = await HotelModel.findById(user.hotelId).select("_id name");
    if (h) { hotelId = String(h._id); hotelName = h.name; }
  }

  // 2) MANAGER / ATTENDANT: muitas vezes vem via unit
  if (!hotelId && user.hotelUnit) {
    const u = await UnitModel.findById(user.hotelUnit).select("_id hotel");
    if (u?.hotel) {
      const hId = (u.hotel as Types.ObjectId).toString?.() ?? String(u.hotel);
      const h = await HotelModel.findById(hId).select("_id name");
      if (h) {
        hotelId = String(h._id);
        hotelName = h.name;
        unitId = String(u._id);
      }
    }
  }

  // 3) fallback: se o proprio usuario tem um campo reference (ex.: user.hotel)
  if (!hotelId && user.hotel) {
    const h = await HotelModel.findById(user.hotel).select("_id name");
    if (h) { hotelId = String(h._id); hotelName = h.name; }
  }

  return { hotelId, hotelName, unitId };
}

// Alias para compatibilidade
export const resolveRestaurantForUser = resolveHotelForUser;
