// utils/resolveHotelForUser.ts
import { HotelModel } from "../models/Hotel";

type ResolvedCtx = {
  hotelId: string | null;
  hotelName: string | null;
  hotelSlug: string | null;
  unitId: string | null;
};

export async function resolveHotelForUser(user: any): Promise<ResolvedCtx> {
  let hotelId: string | null = null;
  let hotelName: string | null = null;
  let hotelSlug: string | null = null;
  let unitId: string | null = null;

  // aplicável apenas para papéis dentro do hotel
  if (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "ATTENDANT") {
    const hotelQuery = (user as any).hotel
      ? { _id: (user as any).hotel }
      : { owner: user._id };

    const h = await HotelModel.findOne(hotelQuery).select("_id name slug units").lean();
    if (h) {
      hotelId = String(h._id);
      hotelName = h.name;
      hotelSlug = h.slug;

      if (Array.isArray(h.units) && h.units.length > 0) {
        const userUnitId = (user as any).unit;
        const chosen = userUnitId ?? h.units[0];
        unitId = String(chosen);
      }
    }
  }

  return { hotelId, hotelName, hotelSlug, unitId };
}
