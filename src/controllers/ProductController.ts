// controllers/ProductController.ts
import { Request, Response } from "express";
import { Types } from "mongoose";
import cloudinary from "../config/cloudinary";
import {
  ProductModel,
  createProduct,
  deleteProduct,
  getProductById,
  getProductByName,
  getProductsByHotel,
  getDistinctCategories,
  updateProduct,
  SERVICE_CATEGORY_SUGGESTIONS,
} from "../models/Products";

// ─────────────────────────────────────────────
//  Helpers de parse
// ─────────────────────────────────────────────

/**
 * Converte valores monetários recebidos de FormData ou JSON.
 * Aceita: número puro em centavos (1500 → 15.00), string
 * formatada ("R$ 15,00" ou "15.00") ou null.
 */
function parseMoneyField(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;

  if (typeof val === "number") return val / 100;

  if (typeof val === "string") {
    const hasFormatting = /[R$,.]/.test(val);
    if (hasFormatting) {
      const normalized = val
        .replace(/[^\d.,-]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const n = Number(normalized);
      return Number.isNaN(n) ? null : n;
    }
    const n = Number(val);
    return Number.isNaN(n) ? null : n / 100;
  }

  return null;
}

function parseBooleanField(val: any, defaultValue = false): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1;
  if (typeof val === "string")
    return ["true", "1", "on", "yes"].includes(val.toLowerCase());
  return defaultValue;
}

function parseJSONField<T = any>(val: any): T | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return val as T;
}

// ─────────────────────────────────────────────
//  Upload de imagem (Cloudinary)
// ─────────────────────────────────────────────

type ImgOut = {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  blurDataURL?: string;
};

export async function handleIncomingImage(req: any): Promise<ImgOut | null> {
  const file = req.file;
  if (!file) return null;

  if (!file.buffer) {
    throw new Error("Multer file.buffer ausente. Verifique memoryStorage.");
  }
  if (!file.mimetype?.startsWith("image/")) {
    throw new Error(`Arquivo inválido: mimetype=${file.mimetype}`);
  }

  const uploadResult = await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "roomly/products", resource_type: "image" },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(file.buffer);
  });

  return {
    url: uploadResult.secure_url || uploadResult.url,
    publicId: uploadResult.public_id,
    width: uploadResult.width,
    height: uploadResult.height,
  };
}

// ─────────────────────────────────────────────
//  CREATE — POST /hotels/:hotelId/products
// ─────────────────────────────────────────────

export const createProductController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();
    if (!hotelId) {
      return res.status(400).json({ message: "hotelId é obrigatório" });
    }

    const {
      name,
      category,
      subcategory,
      description,
      price,
      costPrice,
      image: imageFromBody,
      quantity,
      isAvailable,
      isOnPromotion,
      discountPercentage,
      promotionalPrice,
      promotionStartDate,
      promotionEndDate,
      promotionLabel,
      isAdditional,
      hasAddons,
      additionalOptions,
      accompaniments,
      preparationGroups,
      isCombo,
      comboOptions,
      estimatedDeliveryMinutes,
      deliveryType,
    } = req.body as any;

    // Campos obrigatórios
    if (!name?.trim() || !category?.trim()) {
      return res.status(400).json({ message: "name e category são obrigatórios" });
    }

    const priceNumber = parseMoneyField(price);
    if (priceNumber === null || priceNumber <= 0) {
      return res.status(400).json({ message: "Preço inválido" });
    }

    // Unicidade por hotel + nome
    const duplicate = await getProductByName(hotelId, name.trim());
    if (duplicate) {
      return res
        .status(400)
        .json({ message: "Já existe um serviço/produto com este nome neste hotel" });
    }

    // Imagem
    let imageUrl = "";
    let imagePublicId: string | undefined;
    let imageBlur: string | undefined;
    let imageWidth: number | undefined;
    let imageHeight: number | undefined;

    const imgOut = req.file ? await handleIncomingImage(req) : null;
    if (imgOut) {
      imageUrl = imgOut.url;
      imagePublicId = imgOut.publicId;
      imageBlur = imgOut.blurDataURL;
      imageWidth = imgOut.width;
      imageHeight = imgOut.height;
    } else if (imageFromBody) {
      imageUrl = imageFromBody;
    }

    // Promoção
    const isOnPromotionBool = parseBooleanField(isOnPromotion, false);
    const discountNumber =
      discountPercentage != null && discountPercentage !== ""
        ? Number(discountPercentage)
        : null;

    let promoPriceNumber = parseMoneyField(promotionalPrice);
    let finalPromoPrice: number | null = null;

    if (isOnPromotionBool) {
      if (promoPriceNumber !== null) {
        finalPromoPrice = promoPriceNumber;
      } else if (discountNumber !== null && !Number.isNaN(discountNumber)) {
        finalPromoPrice = priceNumber - priceNumber * (discountNumber / 100);
      }
    }

    // Arrays JSON opcionais
    const additionalOptionsParsed = parseJSONField<any[]>(additionalOptions) ?? [];
    const accompanimentsParsed = parseJSONField<any[]>(accompaniments) ?? [];
    const preparationGroupsParsed = parseJSONField<any[]>(preparationGroups) ?? [];
    const comboOptionsParsed = parseJSONField<any[]>(comboOptions) ?? [];

    const quantityNumber =
      quantity != null && quantity !== "" ? Number(quantity) : -1; // -1 = ilimitado

    const productData: Record<string, any> = {
      hotel: hotelId,
      name: name.trim(),
      category: category.trim(),
      subcategory: subcategory?.trim() || undefined,
      description: description?.trim() ?? "",
      price: priceNumber,
      costPrice: parseMoneyField(costPrice) ?? 0,
      image: imageUrl,
      imagePublicId,
      imageBlur,
      imageWidth,
      imageHeight,
      quantity: Number.isNaN(quantityNumber) ? -1 : quantityNumber,
      isAvailable: parseBooleanField(isAvailable, true),
      estimatedDeliveryMinutes:
        estimatedDeliveryMinutes != null ? Number(estimatedDeliveryMinutes) : undefined,
      deliveryType: deliveryType ?? "room_delivery",
      isOnPromotion: isOnPromotionBool,
      discountPercentage:
        discountNumber !== null && !Number.isNaN(discountNumber) ? discountNumber : null,
      promotionalPrice: finalPromoPrice,
      promotionStartDate: promotionStartDate ? new Date(promotionStartDate) : null,
      promotionEndDate: promotionEndDate ? new Date(promotionEndDate) : null,
      promotionLabel: promotionLabel ?? null,
      isAdditional: parseBooleanField(isAdditional, false),
      hasAddons: parseBooleanField(hasAddons, false),
      additionalOptions: additionalOptionsParsed,
      accompaniments: accompanimentsParsed,
      preparationGroups: preparationGroupsParsed,
      isCombo: parseBooleanField(isCombo, false),
      comboOptions: comboOptionsParsed,
    };

    const product = await createProduct(productData);
    return res.status(201).json(product);
  } catch (error: any) {
    console.error("createProductController error:", error);
    return res.status(500).json({ message: "Erro ao criar produto/serviço", error: error.message });
  }
};

// ─────────────────────────────────────────────
//  READ — GET /hotels/:hotelId/products
// ─────────────────────────────────────────────

export const listProductsController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();
    const { category, available } = req.query as Record<string, string>;

    let query: any = { hotel: hotelId };
    if (category) query.category = category;
    if (available === "true") query.isAvailable = true;
    if (available === "false") query.isAvailable = false;

    const products = await ProductModel.find(query).lean({ virtuals: false });

    // Adiciona finalPrice manualmente pois lean() não executa métodos
    const result = products.map((p: any) => {
      const isPromo =
        (p.discountPercentage > 0 || p.promotionalPrice > 0) &&
        (!p.promotionStartDate || new Date(p.promotionStartDate) <= new Date()) &&
        (!p.promotionEndDate || new Date(p.promotionEndDate) >= new Date());

      let finalPrice = Number(p.price);
      if (isPromo) {
        if (p.promotionalPrice > 0) {
          finalPrice = p.promotionalPrice;
        } else if (p.discountPercentage > 0) {
          finalPrice = p.price * (1 - p.discountPercentage / 100);
        }
      }

      return { ...p, isOnPromotion: isPromo, finalPrice: Number(finalPrice.toFixed(2)) };
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("listProductsController error:", error);
    return res.status(500).json({ message: "Erro ao listar produtos/serviços" });
  }
};

// ─────────────────────────────────────────────
//  READ — GET /hotels/:hotelId/products/categories
//  Retorna as categorias distintas do hotel +
//  as sugestões padrão (para o frontend mostrar hints)
// ─────────────────────────────────────────────

export const listCategoriesController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();

    const categories = await getDistinctCategories(hotelId);

    return res.status(200).json({
      categories,
      suggestions: SERVICE_CATEGORY_SUGGESTIONS,
    });
  } catch (error: any) {
    console.error("listCategoriesController error:", error);
    return res.status(500).json({ message: "Erro ao listar categorias" });
  }
};

// ─────────────────────────────────────────────
//  READ — GET /hotels/:hotelId/products/:productId
// ─────────────────────────────────────────────

export const getProductController = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const product = await getProductById(productId);
    if (!product) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }
    return res.status(200).json(product.toJSON());
  } catch (error: any) {
    console.error("getProductController error:", error);
    return res.status(500).json({ message: "Erro ao buscar produto/serviço" });
  }
};

// ─────────────────────────────────────────────
//  UPDATE — PATCH /hotels/:hotelId/products/:productId
// ─────────────────────────────────────────────

export const updateProductController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();
    const { productId } = req.params;

    const product = await getProductById(productId);
    if (!product || String(product.hotel) !== hotelId) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    const {
      name,
      category,
      subcategory,
      description,
      price,
      costPrice,
      image: imageFromBody,
      quantity,
      isAvailable,
      isOnPromotion,
      discountPercentage,
      promotionalPrice,
      promotionStartDate,
      promotionEndDate,
      promotionLabel,
      isAdditional,
      hasAddons,
      additionalOptions,
      accompaniments,
      preparationGroups,
      isCombo,
      comboOptions,
      estimatedDeliveryMinutes,
      deliveryType,
    } = req.body as any;

    const updates: Record<string, any> = {};

    if (name?.trim()) updates.name = name.trim();
    if (category?.trim()) updates.category = category.trim();
    if (subcategory !== undefined) updates.subcategory = subcategory?.trim() || undefined;
    if (description !== undefined) updates.description = description.trim();

    if (price !== undefined) {
      const p = parseMoneyField(price);
      if (p !== null && p > 0) updates.price = p;
    }

    if (costPrice !== undefined) {
      const cp = parseMoneyField(costPrice);
      if (cp !== null) updates.costPrice = cp;
    }

    if (quantity !== undefined && quantity !== "") {
      updates.quantity = Number(quantity);
    }

    if (isAvailable !== undefined) {
      updates.isAvailable = parseBooleanField(isAvailable);
    }

    if (deliveryType !== undefined) updates.deliveryType = deliveryType;
    if (estimatedDeliveryMinutes !== undefined) {
      updates.estimatedDeliveryMinutes = Number(estimatedDeliveryMinutes);
    }

    // Imagem
    const imgOut = req.file ? await handleIncomingImage(req) : null;
    if (imgOut) {
      // Deleta imagem antiga do Cloudinary se existir
      if (product.imagePublicId) {
        await cloudinary.uploader
          .destroy(product.imagePublicId)
          .catch((e: any) => console.warn("Cloudinary destroy warn:", e.message));
      }
      updates.image = imgOut.url;
      updates.imagePublicId = imgOut.publicId;
      updates.imageWidth = imgOut.width;
      updates.imageHeight = imgOut.height;
    } else if (imageFromBody !== undefined) {
      updates.image = imageFromBody;
    }

    // Promoção
    if (isOnPromotion !== undefined) updates.isOnPromotion = parseBooleanField(isOnPromotion);
    if (discountPercentage !== undefined) {
      updates.discountPercentage =
        discountPercentage !== null && discountPercentage !== "" ? Number(discountPercentage) : null;
    }
    if (promotionalPrice !== undefined) {
      updates.promotionalPrice = parseMoneyField(promotionalPrice);
    }
    if (promotionStartDate !== undefined) {
      updates.promotionStartDate = promotionStartDate ? new Date(promotionStartDate) : null;
    }
    if (promotionEndDate !== undefined) {
      updates.promotionEndDate = promotionEndDate ? new Date(promotionEndDate) : null;
    }
    if (promotionLabel !== undefined) updates.promotionLabel = promotionLabel ?? null;

    // Arrays
    if (additionalOptions !== undefined) {
      updates.additionalOptions = parseJSONField<any[]>(additionalOptions) ?? [];
    }
    if (accompaniments !== undefined) {
      updates.accompaniments = parseJSONField<any[]>(accompaniments) ?? [];
    }
    if (preparationGroups !== undefined) {
      updates.preparationGroups = parseJSONField<any[]>(preparationGroups) ?? [];
    }
    if (comboOptions !== undefined) {
      updates.comboOptions = parseJSONField<any[]>(comboOptions) ?? [];
    }
    if (isAdditional !== undefined) updates.isAdditional = parseBooleanField(isAdditional);
    if (hasAddons !== undefined) updates.hasAddons = parseBooleanField(hasAddons);
    if (isCombo !== undefined) updates.isCombo = parseBooleanField(isCombo);

    const updated = await updateProduct(productId, updates);
    if (!updated) {
      return res.status(404).json({ message: "Produto/serviço não encontrado para atualização" });
    }

    return res.status(200).json(updated.toJSON());
  } catch (error: any) {
    console.error("updateProductController error:", error);
    return res.status(500).json({ message: "Erro ao atualizar produto/serviço", error: error.message });
  }
};

// ─────────────────────────────────────────────
//  DELETE — DELETE /hotels/:hotelId/products/:productId
// ─────────────────────────────────────────────

export const deleteProductController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();
    const { productId } = req.params;

    const product = await getProductById(productId);
    if (!product || String(product.hotel) !== hotelId) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    // Remove imagem do Cloudinary
    if (product.imagePublicId) {
      await cloudinary.uploader
        .destroy(product.imagePublicId)
        .catch((e: any) => console.warn("Cloudinary destroy warn:", e.message));
    }

    await deleteProduct(productId);
    return res.status(200).json({ message: "Produto/serviço removido com sucesso" });
  } catch (error: any) {
    console.error("deleteProductController error:", error);
    return res.status(500).json({ message: "Erro ao remover produto/serviço" });
  }
};

// ─────────────────────────────────────────────
//  TOGGLE AVAILABILITY — PATCH /hotels/:hotelId/products/:productId/availability
// ─────────────────────────────────────────────

export const toggleAvailabilityController = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const product = await getProductById(productId);
    if (!product) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    product.isAvailable = !product.isAvailable;
    await product.save();

    return res.status(200).json({
      _id: product._id,
      isAvailable: product.isAvailable,
    });
  } catch (error: any) {
    console.error("toggleAvailabilityController error:", error);
    return res.status(500).json({ message: "Erro ao alternar disponibilidade" });
  }
};

// ─────────────────────────────────────────────
//  PROMOÇÃO — SET  PATCH /hotels/:hotelId/products/:productId/promotion
// ─────────────────────────────────────────────

export const setProductPromotionController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();
    const { productId } = req.params;
    const {
      discountPercentage = null,
      promotionalPrice = null,
      promotionStartDate = null,
      promotionEndDate = null,
      promotionLabel = null,
    } = req.body || {};

    const update: Record<string, any> = {
      discountPercentage: discountPercentage ?? null,
      promotionalPrice: promotionalPrice ?? null,
      promotionStartDate: promotionStartDate ? new Date(promotionStartDate) : null,
      promotionEndDate: promotionEndDate ? new Date(promotionEndDate) : null,
      promotionLabel: promotionLabel ?? null,
    };

    const product = await ProductModel.findOneAndUpdate(
      { _id: productId, hotel: hotelId },
      update,
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    return res.status(200).json({
      ...product.toJSON(),
      finalPrice: product.getFinalPrice(),
      isOnPromotion: product.isPromotionActive(),
    });
  } catch (error: any) {
    console.error("setProductPromotionController error:", error);
    return res.status(500).json({ message: "Erro ao definir promoção" });
  }
};

// ─────────────────────────────────────────────
//  PROMOÇÃO — CLEAR  DELETE /hotels/:hotelId/products/:productId/promotion
// ─────────────────────────────────────────────

export const clearProductPromotionController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId || req.params.id || "").trim();
    const { productId } = req.params;

    const product = await ProductModel.findOneAndUpdate(
      { _id: productId, hotel: hotelId },
      {
        $set: {
          discountPercentage: null,
          promotionalPrice: null,
          promotionStartDate: null,
          promotionEndDate: null,
          promotionLabel: null,
        },
      },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    return res.status(200).json({
      ...product.toJSON(),
      finalPrice: product.getFinalPrice(),
      isOnPromotion: product.isPromotionActive(),
    });
  } catch (error: any) {
    console.error("clearProductPromotionController error:", error);
    return res.status(500).json({ message: "Erro ao remover promoção" });
  }
};

// ─────────────────────────────────────────────
//  ADICIONAIS
// ─────────────────────────────────────────────

export const addAdditionalToProductController = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { additional } = req.body;

    const product = await getProductById(productId);
    if (!product) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    if (!product.additionalOptions) product.additionalOptions = [];
    product.additionalOptions.push(additional);
    await product.save();

    return res.status(200).json(product.toJSON());
  } catch (error: any) {
    console.error("addAdditionalToProductController error:", error);
    return res.status(500).json({ message: "Erro ao adicionar item adicional" });
  }
};

export const removeAdditionalFromProductController = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { additionalId } = req.body;

    const product = await getProductById(productId);
    if (!product) {
      return res.status(404).json({ message: "Produto/serviço não encontrado" });
    }

    if (!product.additionalOptions) product.additionalOptions = [];
    product.additionalOptions = product.additionalOptions.filter(
      (a) => a.id?.toString() !== additionalId
    );
    await product.save();

    return res.status(200).json(product.toJSON());
  } catch (error: any) {
    console.error("removeAdditionalFromProductController error:", error);
    return res.status(500).json({ message: "Erro ao remover item adicional" });
  }
};