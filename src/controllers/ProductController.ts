import { Request, Response} from "express";
import fs from "fs/promises";
import path from "path";
import {
  createProduct,
  deleteProduct,
  getProductById,
  getProductByName,
  getProductsByRestaurant,
  ProductModel,
  updateProduct
} from "../models/Products";
import { parseDataURL } from "../utils/parseDataURL";
import { processAndSaveProductImage } from "../infra/image";
import { IProduct } from "../models";
import { Types } from "mongoose";
import { PromotionModel } from "../models/Promotions";

async function handleIncomingImage(req: Request) {
  // 1) arquivo multipart
  if (req.file?.buffer) {
    return await processAndSaveProductImage(req.file.buffer, "products");
  }
  // 2) data URL enviada no body (caso clientes antigos ainda mandem base64)
  const raw = req.body.image;
  if (typeof raw === "string" && raw.startsWith("data:image/")) {
    const parsed = parseDataURL(raw);
    if (parsed) {
      return await processAndSaveProductImage(parsed.buffer, "products");
    }
  }
  // 3) nenhuma imagem nova -> retornar null (mantém a existente)
  return null;
}

export const createFoodController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id: restaurantId } = req.params;
    const {
      name,
      category,
      description,
      price,
      image: imageFromBody,
      quantity,
      isOnPromotion,
      discountPercentage,
      promotionalPrice,
      promotionStartDate,
      promotionEndDate,
      isAdditional,
      hasAddons,
      additionalOptions,
      accompaniments
    } = req.body;

    // Verificações básicas
    if (!name || !restaurantId || !category || typeof price !== 'number') {
      return res.status(400).json({ message: "Campos obrigatórios ausentes" });
    }

    // Verificar se já existe produto com o mesmo nome
    const sameName = await getProductByName(name);
    if (sameName) {
      return res.status(400).json({ message: "Já existe um produto com este nome" });
    }

    let imageUrl: string | undefined = undefined;
    let imageBlur: string | undefined = undefined;
    let imageWidth: number | undefined = undefined;
    let imageHeight: number | undefined = undefined;

    const imgOut = await handleIncomingImage(req);
        if (imgOut) {
      imageUrl = imgOut.url;                     // ex.: "/uploads/products/abc123/original.jpg"
      imageBlur = imgOut.blurDataURL;            // base64 LQIP
      imageWidth = imgOut.width;
      imageHeight = imgOut.height;
    } else if (imageFromBody) {
      // Mantém compatibilidade se você já salva uma URL pronta no body
      imageUrl = imageFromBody;
    }

    // Cálculo do preço promocional se não for fornecido
    let calculatedPromotionalPrice = promotionalPrice;
    if (isOnPromotion && discountPercentage && !promotionalPrice) {
      calculatedPromotionalPrice = price - (price * (discountPercentage / 100));
    }

    const productData = {
      restaurant: restaurantId,
      name,
      category,
      description,
      price,
      image: imageUrl,          // mantém o campo original
      imageBlur: imageBlur,     // novo (LQIP)
      imageWidth,
      imageHeight,
      quantity,
      isOnPromotion: isOnPromotion || false,
      discountPercentage,
      promotionalPrice: calculatedPromotionalPrice,
      promotionStartDate,
      promotionEndDate,
      isAdditional: isAdditional || false,
      hasAddons: hasAddons || false, // Certifique-se de inicializar ou validar
      additionalOptions: additionalOptions || [], // Certifique-se de inicializar ou validar
      accompaniments: accompaniments || [] // Certifique-se de inicializar ou validar
    };

    const newFood = await createProduct(productData);
    return res.status(201).json(newFood);
  } catch (error) {
    console.error("Erro ao criar produto:", error);
    return res.status(500).json({ message: "Erro ao criar produto" });
  }
};

export const getAllFoodsController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id: restaurantId } = req.params;
    const currentDate = new Date();

    const products = await getProductsByRestaurant(restaurantId);

    const processedProducts = products.map((product: IProduct) => {
      const isPromotionValid = product.isOnPromotion &&
        product.promotionEndDate &&
        new Date(product.promotionEndDate) > currentDate;

      return {
        ...product.toObject(),
        isOnPromotion: isPromotionValid,
        price: isPromotionValid ? product.promotionalPrice : product.price,
        originalPrice: isPromotionValid ? product.price : undefined,
        promotionDiscount: product.discountPercentage
      };
    });

    return res.status(200).json(processedProducts);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    return res.status(500).json({ message: "Erro ao buscar produtos" });
  }
};

export const getFoodByIdController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;
    const product = await getProductById(id);

    if (!product) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    res.status(200).json(product);
  } catch (error) {
    console.error("Erro ao buscar produto:", error);
    return res.status(500).json({ message: "Erro ao buscar produto" });
  }
};

export async function listProductsController(req: Request, res: Response) {
  try {
    const { restaurantId, unitId } = req.query as { restaurantId: string; unitId?: string };
    const now = new Date();

    const pipeline: any[] = [
      { $match: { restaurant: new Types.ObjectId(restaurantId) } },
      {
        $lookup: {
          from: "promotions",
          let: {
            prodId: "$_id",
            prodCategory: "$category",
            restId: new Types.ObjectId(restaurantId),
            unitIdParam: unitId ? new Types.ObjectId(unitId) : null,
            now: now
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$restaurant", "$$restId"] },
                    { $lte: ["$startDate", "$$now"] },
                    { $gte: ["$endDate", "$$now"] },
                    {
                      $or: [
                        // 1) produto
                        { $and: [ { $eq: ["$scope","product"] },  { $eq: ["$product","$$prodId"] } ] },

                        // 2) categoria + unidade
                        { $and: [
                          { $eq: ["$scope","category"] },
                          { $eq: ["$category","$$prodCategory"] },
                          { $ne: ["$$unitIdParam", null] },
                          { $eq: ["$unit","$$unitIdParam"] },
                        ]},

                        // 3) categoria + restaurante
                        { $and: [
                          { $eq: ["$scope","category"] },
                          { $eq: ["$category","$$prodCategory"] },
                          { $eq: ["$unit", null] },
                        ]},

                        // 4) unidade (todas categorias)
                        { $and: [
                          { $eq: ["$scope","unit"] },
                          { $ne: ["$$unitIdParam", null] },
                          { $eq: ["$unit","$$unitIdParam"] },
                        ]},

                        // 5) restaurante (global)
                        { $and: [
                          { $eq: ["$scope","restaurant"] },
                          { $eq: ["$unit", null] },
                        ]},
                      ],
                    },
                  ],
                },
              },
            },
            {
              $addFields: {
                _priority: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$scope","product"] }, then: 1 },
                      { case: { $and: [ { $eq: ["$scope","category"] }, { $ne: ["$unit", null] } ] }, then: 2 },
                      { case: { $and: [ { $eq: ["$scope","category"] }, { $eq: ["$unit", null] } ] }, then: 3 },
                      { case: { $eq: ["$scope","unit"] }, then: 4 },
                      { case: { $eq: ["$scope","restaurant"] }, then: 5 },
                    ],
                    default: 99
                  }
                }
              }
            },
            { $sort: { _priority: 1, createdAt: -1 } },
          ],
          as: "_promos",
        },
      },
      { $addFields: { effectivePromotion: { $first: "$_promos" } } },
      {
        $addFields: {
          isOnPromotion: { $cond: [ { $ifNull: ["$effectivePromotion", false] }, true, false ] },
          discountPercentage: "$effectivePromotion.discountPercentage",
          promotionalPrice: {
            $cond: [
              { $ifNull: ["$effectivePromotion.promotionalPrice", false] },
              "$effectivePromotion.promotionalPrice",
              {
                $cond: [
                  { $ifNull: ["$effectivePromotion.discountPercentage", false] },
                  {
                    $round: [
                      {
                        $multiply: [
                          "$price",
                          { $subtract: [1, { $divide: ["$effectivePromotion.discountPercentage", 100] }] }
                        ]
                      },
                      2
                    ]
                  },
                  null
                ]
              }
            ]
          },
          promotionStartDate: "$effectivePromotion.startDate",
          promotionEndDate: "$effectivePromotion.endDate",
        }
      },
      { $project: { _promos: 0, effectivePromotion: 0 } }
    ];

    const data = await ProductModel.aggregate(pipeline);
    return res.json(data);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Erro ao listar produtos" });
  }
}

export const updateFoodController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingProduct = await getProductById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    const toBool = (v: any) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true";
      return undefined;
    };
    const toDate = (v: any) => {
      if (!v) return undefined;
      const d = new Date(v);
      return isNaN(d.getTime()) ? undefined : d;
    };

    // >>>>>>> ADIÇÃO: parser simples para dinheiro
    const parseMoney = (v: any): number | undefined => {
      if (v === null || v === undefined) return undefined;
      if (typeof v === "number") return Number.isFinite(v) ? v : undefined;

      const raw = String(v).trim();
      if (!raw) return undefined;

      // tem separador decimal explícito
      if (/[.,]/.test(raw)) {
        const s = raw
          .replace(/[^\d.,-]/g, "")                // mantém só dígitos , . e sinal
          .replace(/\.(?=\d{3}(?:\.|,|$))/g, "")   // remove pontos de milhar
          .replace(",", ".");
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      }

      // só dígitos: últimos 2 são centavos
      const digits = raw.replace(/\D/g, "");
      if (!digits) return undefined;
      const inteiro = digits.slice(0, -2) || "0";
      const frac = digits.slice(-2).padStart(2, "0");
      const n = Number(`${inteiro}.${frac}`);
      return Number.isFinite(n) ? n : undefined;
    };
    // <<<<<<<

    const {
      name,
      category,
      description,
      image,
      discountPercentage: discStr,
      promotionalPrice: promoStr,
      promotionStartDate: startStr,
      promotionEndDate: endStr,
      additionalOptions,
    } = req.body as any;

    const quantity =
      (req.body as any).quantity !== undefined
        ? Number((req.body as any).quantity)
        : undefined;

    const isAvailable = toBool((req.body as any).isAvailable);
    const isOnPromotion = toBool((req.body as any).isOnPromotion) ?? false;

    // IMAGEM
    let imagePatch: string | undefined;
    let imageBlurPatch: string | undefined;
    let imageWidthPatch: number | undefined;
    let imageHeightPatch: number | undefined;

    const imgOut = await (async function handleIncomingImage(req: Request) {
      // 1) arquivo multipart (multer + memoryStorage)
      if (req.file?.buffer) {
        return await processAndSaveProductImage(req.file.buffer, "products");
      }
      // 2) data URL enviada no body
      const raw = (req.body as any).image;
      if (typeof raw === "string" && raw.startsWith("data:image/")) {
        const parsed = parseDataURL(raw);
        if (parsed) {
          return await processAndSaveProductImage(parsed.buffer, "products");
        }
      }
      return null;
    })(req);

    if (imgOut) {
      imagePatch       = imgOut.url;         // ex.: "/uploads/products/abc123/original.jpg"
      imageBlurPatch   = imgOut.blurDataURL; // base64
      imageWidthPatch  = imgOut.width;
      imageHeightPatch = imgOut.height;
    } else if (typeof (req.body as any).image === "string") {
      // mantém compatibilidade se já vier URL pronta
      const raw = (req.body as any).image;
      if (raw.startsWith("/uploads/") || raw.startsWith("http")) {
        imagePatch = raw;
      }
    }

    // PROMOÇÃO
    const discountPercentage =
      isOnPromotion ? Number(discStr ?? "") : undefined;

    const basePriceParsed =
      parseMoney((req.body as any).price) ?? existingProduct.price;

    const promotionalPriceInput =
      isOnPromotion ? parseMoney(promoStr) : undefined;

    let promotionalPrice =
      isOnPromotion && promotionalPriceInput == null && discountPercentage != null
        ? basePriceParsed - basePriceParsed * (discountPercentage / 100)
        : promotionalPriceInput;

    const promotionStartDate = isOnPromotion ? toDate(startStr) : undefined;
    const promotionEndDate = isOnPromotion ? toDate(endStr) : undefined;

    // montar patch
    const updatedData: any = {
      name: name?.trim(),
      category: category?.trim(),
      description: description?.trim(),
      isAvailable,
      isOnPromotion: isOnPromotion || false,
      additionalOptions,
    };

    // preço e custo (AGORA parseados corretamente)
    const priceParsed = parseMoney((req.body as any).price);
    if (priceParsed !== undefined) updatedData.price = priceParsed;

    const costParsed = parseMoney((req.body as any).costPrice);
    if (costParsed !== undefined) updatedData.costPrice = costParsed;

    if (quantity !== undefined && !Number.isNaN(quantity)) {
      updatedData.quantity = quantity;
    }

    if (imagePatch !== undefined) {
      updatedData.image = imagePatch;
      // se você guarda esses campos no model, atualiza também:
      if (imageBlurPatch !== undefined)   updatedData.imageBlur   = imageBlurPatch;
      if (imageWidthPatch !== undefined)  updatedData.imageWidth  = imageWidthPatch;
      if (imageHeightPatch !== undefined) updatedData.imageHeight = imageHeightPatch;
    } else if (typeof image === "string" && image.startsWith("/uploads/")) {
      updatedData.image = image; // mantém a atual se veio path válido no body
    }

    if (isOnPromotion) {
      updatedData.discountPercentage =
        Number.isFinite(discountPercentage!) ? discountPercentage : null;
      updatedData.promotionalPrice =
        promotionalPrice != null && Number.isFinite(promotionalPrice)
          ? promotionalPrice
          : null;
      updatedData.promotionStartDate = promotionStartDate ?? null;
      updatedData.promotionEndDate = promotionEndDate ?? null;
    } else {
      updatedData.discountPercentage = null;
      updatedData.promotionalPrice = null;
      updatedData.promotionStartDate = null;
      updatedData.promotionEndDate = null;
    }

    // remove vazios
    Object.keys(updatedData).forEach((k) => {
      if (updatedData[k] === undefined || updatedData[k] === "") {
        delete updatedData[k];
      }
    });

    const updatedProduct = await updateProduct(id, updatedData);
    return res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Erro ao atualizar produto:", error);
    return res.status(500).json({ message: "Erro ao atualizar produto" });
  }
};


export const deleteFoodController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const product = await getProductById(id);
    if (!product) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    const deletedFood = await deleteProduct(id);
    return res.status(200).json({ message: "Produto excluído com sucesso" });
  } catch (error) {
    console.error("Erro ao excluir produto:", error);
    return res.status(500).json({ message: "Erro ao excluir produto" });
  }
};

export const createMultipleProductsController = async (
  req: Request,
  res: Response
) => {
  try {
    const { products } = req.body;
    const restaurantId = req.params.id;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "Lista de produtos inválida" });
    }

    const createdProducts = [];

    for (const product of products) {
      // Adicionar restaurantId a cada produto
      product.restaurant = restaurantId;

      // Validar campos obrigatórios
      if (!product.name || !product.price) {
        return res.status(400).json({
          message: "Campos obrigatórios ausentes",
          product
        });
      }

      // Cálculo do preço promocional se necessário
      if (product.isOnPromotion && product.discountPercentage && !product.promotionalPrice) {
        product.promotionalPrice = product.price - (product.price * (product.discountPercentage / 100));
      }

      // Criar produto
      const newProduct = await createProduct(product);
      createdProducts.push(newProduct);
    }

    return res.status(201).json(createdProducts);
  } catch (error) {
    console.error("Erro ao criar produtos:", error);
    return res.status(500).json({ message: "Erro ao criar produtos" });
  }
};

// Controlador para criar um combo
export const createComboController = async (
  req: Request,
  res: Response
) => {
  try {
    const { restaurantId } = req.params;
    const { name, price, description, comboOptions } = req.body;

    // Verificações básicas
    if (!name || !price || !comboOptions) {
      return res.status(400).json({ message: "Campos obrigatórios ausentes" });
    }

    const comboData = {
      restaurant: restaurantId,
      name,
      price,
      description,
      isCombo: true,
      comboOptions
    };

    const newCombo = await createProduct(comboData);
    return res.status(201).json(newCombo);
  } catch (error) {
    console.error("Erro ao criar combo:", error);
    return res.status(500).json({ message: "Erro ao criar combo" });
  }
};

// Controlador para atualizar um combo
export const updateComboController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { name, price, description, comboOptions } = req.body;

    const updatedData = {
      name,
      price,
      description,
      comboOptions
    };

    const updatedCombo = await updateProduct(id, updatedData);
    return res.status(200).json(updatedCombo);
  } catch (error) {
    console.error("Erro ao atualizar combo:", error);
    return res.status(500).json({ message: "Erro ao atualizar combo" });
  }
};

export const getAllAdditionalsController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id: restaurantId } = req.params;
    const additionals = await getProductsByRestaurant(restaurantId).where('isAdditional', true);

    return res.status(200).json(additionals);
  } catch (error) {
    console.error("Erro ao buscar adicionais:", error);
    return res.status(500).json({ message: "Erro ao buscar adicionais" });
  }
};

// Adicionar adicional a um produto
export const addAdditionalToProductController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params; // ID do produto
    const { additional } = req.body; // Dados do adicional

    const product = await getProductById(id);
    if (!product) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    if (!product.additionalOptions) {
      product.additionalOptions = [];
    }

    product.additionalOptions.push(additional);
    await product.save();

    return res.status(200).json(product);
  } catch (error) {
    console.error("Erro ao adicionar adicional:", error);
    return res.status(500).json({ message: "Erro ao adicionar adicional" });
  }
};

// Remover adicional de um produto
export const removeAdditionalFromProductController = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params; // ID do produto
    const { additionalId } = req.body; // ID do adicional a ser removido

    const product = await getProductById(id);
    if (!product) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    if (!product.additionalOptions) {
      product.additionalOptions = [];
    }

    product.additionalOptions = product.additionalOptions.filter(
      (additional) => additional.id.toString() !== additionalId
    );
    await product.save();

    return res.status(200).json(product);
  } catch (error) {
    console.error("Erro ao remover adicional:", error);
    return res.status(500).json({ message: "Erro ao remover adicional" });
  }
};

export const setProductPromotionController = async (req: Request, res: Response) => {
  try {
    const { id: unitId, productId } = req.params;
    const {
      discountPercentage = null,
      promotionalPrice = null,
      promotionStartDate = null,
      promotionEndDate = null,
      promotionLabel = null,
    } = req.body || {};

    // Sanitização simples
    const update: any = {
      discountPercentage: discountPercentage ?? null,
      promotionalPrice: promotionalPrice ?? null,
      promotionStartDate: promotionStartDate ? new Date(promotionStartDate) : null,
      promotionEndDate: promotionEndDate ? new Date(promotionEndDate) : null,
      promotionLabel: promotionLabel ?? null,
    };

    const product = await ProductModel.findOneAndUpdate(
      { _id: productId, restaurant: unitId },
      update,
      { new: true }
    );

    if (!product) return res.status(404).json({ message: "Produto não encontrado" });

    const json = product.toJSON();
    return res.status(200).json({
      ...json,
      finalPrice: product.getFinalPrice(),
      isOnPromotion: product.isPromotionActive(),
    });
  } catch (e) {
    console.error("Erro setProductPromotionController", e);
    return res.status(500).json({ message: "Erro ao definir promoção" });
  }
};

export const clearProductPromotionController = async (req: Request, res: Response) => {
  try {
    const { id: unitId, productId } = req.params;
    const product = await ProductModel.findOneAndUpdate(
      { _id: productId, restaurant: unitId },
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
    if (!product) return res.status(404).json({ message: "Produto não encontrado" });
    const json = product.toJSON();
    return res.status(200).json({
      ...json,
      finalPrice: product.getFinalPrice(),
      isOnPromotion: product.isPromotionActive(),
    });
  } catch (e) {
    console.error("Erro clearProductPromotionController", e);
    return res.status(500).json({ message: "Erro ao remover promoção" });
  }
};

// GET /restaurant/:restaurantId/products/promotional
export const listPromotionalProducts = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params;
    const now = new Date();

    // 1) buscar promos ativas por produto
    const promos = await PromotionModel.find(
      {
        restaurant: restaurantId,
        scope: 'product',
        startDate: { $lte: now },
        endDate: { $gte: now },
        active: true,
      },
    ).lean();

    const productIds = promos.map(p => p.productId).filter(Boolean);
    if (productIds.length === 0) return res.status(200).json([]);

    // 2) buscar os produtos
    const products = await ProductModel.find(
      { _id: { $in: productIds }, restaurant: restaurantId },
      { _id: 1, name: 1, price: 1, image: 1, description: 1, category: 1 }
    ).lean();

    // 3) indexar promo por productId e hidratar para a UI atual
    const promosByProduct = new Map(
      promos.map(p => [String(p.productId), p])
    );

    const result = products.map(p => {
      const promo = promosByProduct.get(String(p._id));
      const pct   = promo?.discountPercentage;
      const fixed = promo?.promotionalPrice;

      let finalPrice = p.price;
      if (typeof fixed === 'number' && Number.isFinite(fixed)) {
        finalPrice = fixed;
      } else if (typeof pct === 'number' && pct > 0) {
        finalPrice = Number((p.price * (1 - pct / 100)).toFixed(2));
      }

      return {
        ...p,
        // campos esperados hoje pelas UIs:
        isOnPromotion: true,
        discountPercentage: pct ?? null,
        promotionalPrice: fixed ?? null,
        promotionStartDate: promo?.startDate ?? null,
        promotionEndDate: promo?.endDate ?? null,
        finalPrice,
      };
    });

    res.status(200).json(result);
  } catch (e) {
    console.error('listPromotionalProducts error', e);
    res.status(500).json({ message: 'Erro ao buscar produto' });
  }
};

