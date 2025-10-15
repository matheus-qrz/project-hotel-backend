// src/controllers/CouponsController.ts
import { Request, Response } from "express";
import { Types } from "mongoose";
import { CouponModel } from "../models/Coupon";

/**
 * Validações rápidas do payload no mesmo espírito do seu assertPayload de promoções.
 * Unit pode ser opcional; se enviado, precisa ser ObjectId válido.
 */
function assertCouponPayload(body: any) {
  if (!body?.restaurantId) throw new Error("restaurantId é obrigatório");
  if (!body?.code) throw new Error("code é obrigatório");
  if (!["fixed", "percentage"].includes(body?.type)) throw new Error("type inválido (use 'fixed' ou 'percentage')");
  if (typeof body?.value !== "number" || body.value < 0) throw new Error("value deve ser número >= 0");

  if (body.unitId && !Types.ObjectId.isValid(body.unitId)) {
    throw new Error("unitId inválido");
  }
  if (body.startsAt && isNaN(new Date(body.startsAt).getTime())) throw new Error("startsAt inválido");
  if (body.endsAt && isNaN(new Date(body.endsAt).getTime())) throw new Error("endsAt inválido");
}

/**
 * POST /coupon/create
 */
export async function createCoupon(req: Request, res: Response) {
  try {
    const {
      restaurantId,
      unitId,
      code,
      type,            // "fixed" | "percentage"
      value,           // number
      isActive = true,
      startsAt,
      endsAt,
      usageLimit,
      minSubtotal,
    } = req.body || {};

    assertCouponPayload(req.body);

    const doc = await CouponModel.create({
      restaurant: new Types.ObjectId(restaurantId),
      unit: unitId ? new Types.ObjectId(unitId) : null,
      code: String(code).toUpperCase().trim(),
      type,
      value,
      isActive: Boolean(isActive),
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      usageLimit: usageLimit ?? null,
      minSubtotal: typeof minSubtotal === "number" ? minSubtotal : null,
      createdBy: (req as any).user?._id ?? null, // se você já preenche req.user
    });

    return res.json(doc);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao criar cupom" });
  }
}

/**
 * GET /coupon/list
 * Aceita filtros opcionais: restaurantId, unitId, isActive, code (parcial), onlyUsable (valida janela e isActive).
 */
export async function listCoupons(req: Request, res: Response) {
  try {
    const { restaurantId, unitId, isActive, code, onlyUsable } = req.query as any;

    const q: any = {};
    if (restaurantId) q.restaurant = new Types.ObjectId(restaurantId);
    if (unitId) q.unit = new Types.ObjectId(unitId);
    if (typeof isActive !== "undefined") q.isActive = String(isActive) === "true";

    if (code) {
      const s = String(code).trim().toUpperCase();
      // busca por prefixo ou exato
      q.code = { $regex: `^${s}`, $options: "i" };
    }

    // Filtrar por janela “usável” (now between startsAt/endsAt e ativo)
    if (String(onlyUsable) === "true") {
      const now = new Date();
      q.isActive = true;
      q.$and = [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ];
    }

    const data = await CouponModel.find(q).sort({ createdAt: -1 }).lean();
    return res.json(data);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao listar cupons" });
  }
}

/**
 * GET /coupon/validate?code=MEU5OFF&restaurantId=...&unitId=...&subtotal=...
 * Valida se um cupom está aplicável **neste momento**.
 * - Confere isActive, janela de datas, usageLimit/usedCount, restaurante/unidade e minSubtotal.
 */
export async function validateCoupon(req: Request, res: Response) {
  try {
    const { code, restaurantId, unitId, subtotal } = req.query as any;
    if (!code) return res.status(400).json({ message: "code é obrigatório" });
    if (!restaurantId) return res.status(400).json({ message: "restaurantId é obrigatório" });

    const now = new Date();
    const codeNorm = String(code).trim().toUpperCase();

    const q: any = {
      restaurant: new Types.ObjectId(restaurantId),
      code: codeNorm,
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };

    // Se unitId vier, tentamos casar específico de unidade OU cupom sem unidade (global do restaurante).
    // Se NÃO vier, aceitamos apenas cupons sem unidade.
    if (unitId) {
      q.$or = [{ unit: new Types.ObjectId(unitId) }, { unit: null }];
    } else {
      q.unit = null;
    }

    const coupon = await CouponModel.findOne(q).lean();
    if (!coupon) return res.status(404).json({ message: "Cupom inválido, inativo ou fora de janela." });

    if (coupon.usageLimit && coupon.usedCount && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ message: "Limite de uso atingido." });
    }

    const sub = subtotal != null ? Number(subtotal) : null;
    if (coupon.minSubtotal && (sub == null || isNaN(sub) || sub < coupon.minSubtotal)) {
      return res.status(400).json({ message: `Pedido mínimo de R$ ${coupon.minSubtotal.toFixed(2)}` });
    }

    // ok — devolve apenas o necessário para o front aplicar
    return res.json({
      _id: String(coupon._id),
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      minSubtotal: coupon.minSubtotal ?? null,
      startsAt: coupon.startsAt ?? null,
      endsAt: coupon.endsAt ?? null,
    });
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao validar cupom" });
  }
}

/**
 * PATCH /coupon/:couponId/deactivate
 * Desativa cupom (isActive=false ou opcionalmente antecipa o endsAt).
 */
export async function deactivateCoupon(req: Request, res: Response) {
  try {
    const { couponId } = req.params;
    const updated = await CouponModel.findByIdAndUpdate(
      couponId,
      { $set: { isActive: false, endsAt: new Date() } },
      { new: true }
    );
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao desativar cupom" });
  }
}

/**
 * PATCH /coupon/:couponId/increment-usage
 * Opcional: incremente contagem de uso após um pedido confirmado.
 */
export async function incrementCouponUsage(req: Request, res: Response) {
  try {
    const { couponId } = req.params;
    const updated = await CouponModel.findByIdAndUpdate(
      couponId,
      { $inc: { usedCount: 1 } },
      { new: true }
    );
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao incrementar uso do cupom" });
  }
}
