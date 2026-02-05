// middleware/unitContext.ts
import { Types } from "mongoose";
import { Request, Response, NextFunction } from "express";
import { HotelModel } from "../models/Hotel";
import { HotelUnitModel } from "../models/HotelUnit";

export async function resolveUnitContext(req: Request, res: Response, next: NextFunction) {
  try {
    const unitId = (req.params.unitId || req.query.unitId || req.body.unitId) as string | undefined;
    const hotelSlug = (req.params.hotelSlug || req.query.hotelSlug || req.body.hotelSlug || req.params.slug) as string | undefined;
    const hotelId = (req.params.hotelId || req.query.hotelId || req.body.hotelId) as string | undefined;

    // 1) Resolve hotel
    let hotel: any = null;
    if (hotelId && Types.ObjectId.isValid(hotelId)) {
      hotel = await HotelModel.findById(hotelId).select("_id slug").lean();
    } else if (hotelSlug) {
      hotel = await HotelModel.findOne({ slug: hotelSlug }).select("_id slug").lean();
    }
    if (!hotel) return res.status(404).json({ message: "Hotel nao encontrado." });

    // 2) Resolve unit
    let unit: any = null;
    if (unitId && Types.ObjectId.isValid(unitId)) {
      unit = await HotelUnitModel.findOne({ _id: unitId, hotel: hotel._id, isActive: { $ne: false } })
        .select("_id hotel timezone isMatrix name")
        .lean();
      if (!unit) return res.status(400).json({ message: "Unidade invalida para este hotel." });
    } else {
      // Fallback: matriz (para QRs antigos)
      unit = await HotelUnitModel.findOne({ hotel: hotel._id, isMatrix: true }).lean();
      if (!unit) return res.status(400).json({ message: "Unidade nao especificada e matriz inexistente." });
    }

    (req as any).ctx = {
      hotelId: String(hotel._id),
      unitId: String(unit._id),
      tz: unit.timezone || "America/Sao_Paulo",
    };
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Falha ao resolver contexto de unidade." });
  }
}
