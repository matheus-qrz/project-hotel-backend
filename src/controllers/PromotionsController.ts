// src/controllers/promotionController.ts
import { Request, Response } from "express";
import { Types } from "mongoose";
import { PromotionModel } from "../models/Promotions";

function assertPayload(scope: string, body: any) {
  if (scope === "product" && !body.productId) throw new Error("productId é obrigatório para scope=product");
  if (scope === "category" && !body.category) throw new Error("category é obrigatório para scope=category");
  if (scope === "unit" && !body.unitId) throw new Error("unitId é obrigatório para scope=unit");
  if (scope === "restaurant" && body.unitId) throw new Error("restaurant não deve receber unitId");
}

export async function createPromotion(req: Request, res: Response) {
  try {
    const {
      restaurantId,
      unitId,           
      scope,            
      productId,
      category,
      discountPercentage,
      promotionalPrice,
      startDate,
      endDate,
    } = req.body;

    const pct   = discountPercentage == null || discountPercentage === '' ? undefined : Number(discountPercentage);
    const price = promotionalPrice  == null || promotionalPrice  === '' ? undefined : Number(promotionalPrice);

    if (!!pct === !!price) {
      return res.status(400).json({ message: "Informe apenas discountPercentage OU promotionalPrice." });
    }
    if (scope === 'product' && !productId) {
      return res.status(400).json({ message: "productId é obrigatório quando scope='product'." });
    }

    assertPayload(scope, req.body);

    const promo = await PromotionModel.create({
      restaurant: new Types.ObjectId(restaurantId),
      unit: unitId ? new Types.ObjectId(unitId) : null,
      scope,
      productId:  scope === 'product' ? productId : undefined,
      category: scope === 'category' ? category  : undefined,
      discountPercentage: pct ?? null,
      promotionalPrice: price,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      createdBy: (req as any).user?._id ?? null,
    });

    return res.status(201).json(promo);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao criar promoção" });
  }
}

export async function listPromotions(req: Request, res: Response) {
  try {
    const { restaurantId, unitId, scope, category, productId, active } = req.query as any;

    const now = new Date();
    const q: any = { restaurant: new Types.ObjectId(restaurantId) };
    if (unitId === "null") q.unit = null;
    else if (unitId) q.unit = new Types.ObjectId(unitId);
    if (scope) q.scope = scope;
    if (category) q.category = category;
    if (productId) q.product = new Types.ObjectId(productId);
    if (active === "true") {
      q.startDate = { $lte: now };
      q.endDate = { $gte: now };
    }

    const promos = await PromotionModel.find(q).sort({ createdAt: -1 }).lean();
    return res.json(promos);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao listar promoções" });
  }
}

export async function deactivatePromotion(req: Request, res: Response) {
  try {
    const { promotionId } = req.params;
    const updated = await PromotionModel.findByIdAndUpdate(
      promotionId,
      { $set: { endDate: new Date() } },
      { new: true }
    );
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao desativar promoção" });
  }
}

