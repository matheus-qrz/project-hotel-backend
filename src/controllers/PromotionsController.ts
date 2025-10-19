// src/controllers/promotionController.ts
import { Request, Response } from "express";
import { Types } from "mongoose";
import { PromotionModel } from "../models/Promotions";
import { ProductModel } from "../models/Products";

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
      scope,              // 'product' | 'category'
      productId,          // obrigatório se scope='product'
      category,           // obrigatório se scope='category'
      discountPercentage,
      promotionalPrice,
      startDate,
      endDate,
    } = req.body as {
      restaurantId: string;
      unitId?: string | null;
      scope: 'product' | 'category';
      productId?: string;
      category?: string;
      discountPercentage?: number | string | null;
      promotionalPrice?: number | string | null;
      startDate: string | Date;
      endDate: string | Date;
    };

        // datas válidas
    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    if (!(sDate instanceof Date && !isNaN(+sDate)) || !(eDate instanceof Date && !isNaN(+eDate))) {
      return res.status(400).json({ message: "Datas inválidas" });
    }
    if (eDate <= sDate) {
      return res.status(400).json({ message: "endDate deve ser maior que startDate" });
    }

    // números saneados
    const pctRaw   = discountPercentage == null || discountPercentage === '' ? undefined : Number(discountPercentage);
    const priceRaw = promotionalPrice  == null || promotionalPrice  === '' ? undefined : Number(promotionalPrice);
    const pct   = pctRaw != null && Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : undefined;
    const promotionalPriceIs = priceRaw != null && Number.isFinite(priceRaw) ? Math.max(0, priceRaw) : undefined;

    if (!!pct === !!promotionalPriceIs) {
      return res.status(400).json({ message: "Informe apenas discountPercentage OU promotionalPrice." });
    }
    if (scope === 'product' && !productId) {
      return res.status(400).json({ message: "productId é obrigatório quando scope='product'." });
    }

    assertPayload(scope, req.body);

    let snapshot: {
      productName?: string;
      productCategory?: string;
      originalPrice?: number;
    } = {};

    let productIdObj: Types.ObjectId | undefined = undefined;

    if (scope === 'product') {
      productIdObj = new Types.ObjectId(productId!);
      const prod = await ProductModel
        .findById(productIdObj)
        .select({ name: 1, category: 1, price: 1 })
        .lean();

      if (!prod) return res.status(404).json({ message: "Produto não encontrado para a promoção." });

      const priceNum = typeof prod.price === 'number' ? prod.price : Number(prod.price);
      snapshot = {
        productName: prod.name,
        productCategory: (prod as any).category,
        originalPrice: Number.isFinite(priceNum) ? priceNum : undefined,
      };
    }

    const promo = await PromotionModel.create({
        restaurant: new Types.ObjectId(restaurantId),
        unit: unitId ? new Types.ObjectId(unitId) : null,
        scope,
        productId: scope === 'product' ? productIdObj : undefined,
        category:  scope === 'category' ? category : undefined,
        // snapshots (novos campos opcionais no schema):
        ...snapshot,

        // se for categoria (scope='category'), continue usando `category` normalmente
        discountPercentage: pct ?? null,
        promotionalPrice: promotionalPriceIs ?? null,

        startDate: sDate,
        endDate: eDate,
        createdBy: (req as any).user?._id ?? null,
      });

    return res.status(201).json(promo);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao criar promoção" });
  }
}

export async function listPromotions(req: Request, res: Response) {
  try {
    const {
      restaurantId,
      unitId,
      scope,
      category,
      productId,
      active,
    } = req.query as Record<string, string | undefined>;

    if (!restaurantId) {
      return res.status(400).json({ message: "restaurantId é obrigatório" });
    }

    const now = new Date();
    const q: any = {
      restaurant: Types.ObjectId.isValid(restaurantId)
        ? new Types.ObjectId(restaurantId)
        : restaurantId,
    };

    if (scope) q.scope = scope;
    if (category) q.category = category;

    // (a) sempre use o nome correto do campo:
    if (productId && Types.ObjectId.isValid(productId)) {
      q.productId = new Types.ObjectId(productId);   // NUNCA q.product
    }

    // (b) unitId: "null" => null; id válido => ObjectId; inválido => ignora
    if (unitId === "null") q.unit = null;
    else if (unitId && Types.ObjectId.isValid(unitId)) q.unit = new Types.ObjectId(unitId);

    // (c) active=true => filtra por janela de datas (modelo não usa 'active' boolean)
    if (active === "true") {
      q.startDate = { $lte: now };
      q.endDate   = { $gte: now };
    }

    // projeção opcional para evitar payload gigante
    const projection = {
      restaurant: 1,
      unit: 1,
      scope: 1,
      productId: 1,
      category: 1,
      discountPercentage: 1,
      promotionalPrice: 1,
      startDate: 1,
      endDate: 1,
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
      // snapshots (se existirem) 
      productName: 1,
      productCategory: 1,
      originalPrice: 1,
    };

    const promos = await PromotionModel
      .find(q, projection)
      .sort({ createdAt: -1 })
      .lean();

    return res.json(promos);
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || "Erro ao listar promoções" });
  }
}

// Adicione junto às demais exports do controller

export async function updatePromotion(req: Request, res: Response) {
  try {
    const { promotionId } = req.params;

    if (!promotionId) {
      return res.status(400).json({ message: "promotionId é obrigatório" });
    }

    // Busca a promoção atual para garantir existência e obter scope/refs atuais
    const current = await PromotionModel.findById(promotionId);
    if (!current) {
      return res.status(404).json({ message: "Promoção não encontrada" });
    }

    // Lê body no mesmo formato aceito na criação (mas todos opcionais)
    const {
      restaurantId,
      unitId,
      scope,              // opcional; se vier, validamos com assertPayload
      productId,          // se scope='product'
      category,           // se scope='category'
      discountPercentage,
      promotionalPrice,
      startDate,
      endDate,
    } = req.body as {
      restaurantId?: string;                 // manter coerente (opcional)
      unitId?: string | null;
      scope?: 'product' | 'category' | 'unit' | 'restaurant';
      productId?: string;
      category?: string | null;
      discountPercentage?: number | string | null;
      promotionalPrice?: number | string | null;
      startDate?: string | Date;
      endDate?: string | Date;
    };

    // --------- Datas (opcionais): se vierem, devem ser válidas e end > start ----------
    let sDate: Date | undefined = undefined;
    let eDate: Date | undefined = undefined;
    if (startDate !== undefined) sDate = new Date(startDate);
    if (endDate   !== undefined) eDate = new Date(endDate);

    if (sDate && !(sDate instanceof Date && !isNaN(+sDate))) {
      return res.status(400).json({ message: "startDate inválida" });
    }
    if (eDate && !(eDate instanceof Date && !isNaN(+eDate))) {
      return res.status(400).json({ message: "endDate inválida" });
    }
    if (sDate && eDate && eDate <= sDate) {
      return res.status(400).json({ message: "endDate deve ser maior que startDate" });
    }

    // --------- Numbers (opcionais) + regra XOR ---------
    const pctRaw   = discountPercentage == null || discountPercentage === '' ? undefined : Number(discountPercentage);
    const priceRaw = promotionalPrice  == null || promotionalPrice  === '' ? undefined : Number(promotionalPrice);

    const pct = pctRaw != null && Number.isFinite(pctRaw)
      ? Math.max(0, Math.min(100, pctRaw))
      : undefined;

    const promotionalPriceIs = priceRaw != null && Number.isFinite(priceRaw)
      ? Math.max(0, priceRaw)
      : undefined;

    // Se usuário está tentando alterar valores, a restrição XOR é aplicada
    if ((pct !== undefined) && (promotionalPriceIs !== undefined)) {
      return res.status(400).json({ message: "Informe apenas discountPercentage OU promotionalPrice." });
    }

    // --------- Scope / payload coerentes ---------
    const newScope = scope ?? current.scope;
    // valida campos obrigatórios para o escopo informado (mantém seu padrão)
    // (reaproveita a mesma regra usada no create)
    if (newScope === "product" && (productId === undefined && current.productId == null)) {
      return res.status(400).json({ message: "productId é obrigatório para scope='product'." });
    }
    if (newScope === "category" && (category === undefined && current.category == null)) {
      return res.status(400).json({ message: "category é obrigatório para scope='category'." });
    }

    // Se quiser impedir mudar totalmente o "scope", bastaria checar:
    // if (scope && scope !== current.scope) return res.status(400).json({ message: "Não é permitido alterar o scope da promoção." });

    // --------- Monta $set incremental ---------
    const $set: any = {};
    if (restaurantId) {
      $set.restaurant = Types.ObjectId.isValid(restaurantId)
        ? new Types.ObjectId(restaurantId)
        : restaurantId;
    }

    if (unitId !== undefined) {
      // "null" (string) não é esperado no body; aceitamos null real ou ObjectId válido
      $set.unit = unitId === null
        ? null
        : (Types.ObjectId.isValid(unitId) ? new Types.ObjectId(unitId) : undefined);
    }

    if (scope) $set.scope = newScope;

    // Atualização de alvo conforme escopo
    // PRODUCT: aceita trocar productId e refaz snapshots
    if (newScope === "product") {
      let productIdObj = current.productId;

      if (productId) {
        if (!Types.ObjectId.isValid(productId)) {
          return res.status(400).json({ message: "productId inválido" });
        }
        productIdObj = new Types.ObjectId(productId);
      }

      // Se o productId mudou OU não havia snapshot, refaça snapshot
      if (productId || current.productName == null || current.originalPrice == null) {
        const prod = await ProductModel
          .findById(productIdObj)
          .select({ name: 1, category: 1, price: 1 })
          .lean();

        if (!prod) return res.status(404).json({ message: "Produto não encontrado para a promoção." });

        const priceNum = typeof (prod as any).price === 'number'
          ? (prod as any).price
          : Number((prod as any).price);

        $set.productId = productIdObj;
        $set.productName = prod.name;
        $set.productCategory = (prod as any).category;
        $set.originalPrice = Number.isFinite(priceNum) ? priceNum : undefined;
      }
    }

    // CATEGORY: aceita trocar category
    if (newScope === "category" && category !== undefined) {
      $set.category = category;
    }

    // Desconto / Preço direto: aplica XOR desativando o outro campo
    if (pct !== undefined) {
      $set.discountPercentage = pct;
      $set.promotionalPrice = null;
    } else if (promotionalPriceIs !== undefined) {
      $set.promotionalPrice = promotionalPriceIs;
      $set.discountPercentage = null;
    }

    if (sDate) $set.startDate = sDate;
    if (eDate) $set.endDate   = eDate;

    // Segurança: não gravar propriedades undefined
    Object.keys($set).forEach((k) => $set[k] === undefined && delete $set[k]);

    const updated = await PromotionModel.findByIdAndUpdate(
      promotionId,
      { $set },
      { new: true }
    );

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || "Erro ao atualizar promoção" });
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

