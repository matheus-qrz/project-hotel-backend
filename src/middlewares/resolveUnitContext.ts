// middleware/unitContext.ts
import { Types } from "mongoose";
import { Request, Response, NextFunction } from "express";
import { RestaurantModel } from "../models/Restaurant";
import { RestaurantUnitModel } from "../models/RestaurantUnit";

export async function resolveUnitContext(req: Request, res: Response, next: NextFunction) {
  try {
    const unitId = (req.params.unitId || req.query.unitId || req.body.unitId) as string | undefined;
    const restaurantSlug = (req.params.restaurantSlug || req.query.restaurantSlug || req.body.restaurantSlug || req.params.slug) as string | undefined;
    const restaurantId = (req.params.restaurantId || req.query.restaurantId || req.body.restaurantId) as string | undefined;

    // 1) Resolve restaurant
    let restaurant: any = null;
    if (restaurantId && Types.ObjectId.isValid(restaurantId)) {
      restaurant = await RestaurantModel.findById(restaurantId).select("_id slug").lean();
    } else if (restaurantSlug) {
      restaurant = await RestaurantModel.findOne({ slug: restaurantSlug }).select("_id slug").lean();
    }
    if (!restaurant) return res.status(404).json({ message: "Restaurante não encontrado." });

    // 2) Resolve unit
    let unit: any = null;
    if (unitId && Types.ObjectId.isValid(unitId)) {
      unit = await RestaurantUnitModel.findOne({ _id: unitId, restaurant: restaurant._id, isActive: { $ne: false } })
        .select("_id restaurant timezone isMatrix name")
        .lean();
      if (!unit) return res.status(400).json({ message: "Unidade inválida para este restaurante." });
    } else {
      // Fallback: matriz (para QRs antigos)
      unit = await RestaurantUnitModel.findOne({ restaurant: restaurant._id, isMatrix: true }).lean();
      if (!unit) return res.status(400).json({ message: "Unidade não especificada e matriz inexistente." });
    }

    (req as any).ctx = {
      restaurantId: String(restaurant._id),
      unitId: String(unit._id),
      tz: unit.timezone || "America/Sao_Paulo",
    };
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Falha ao resolver contexto de unidade." });
  }
}
