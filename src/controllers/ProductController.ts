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
      accompaniments,
      preparationGroups
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
      imageUrl = imageFromBody;
    }

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
      image: imageUrl,          
      imageBlur: imageBlur,    
      imageWidth,
      imageHeight,
      quantity,
      isOnPromotion: isOnPromotion || false,
      discountPercentage,
      promotionalPrice: calculatedPromotionalPrice,
      promotionStartDate,
      promotionEndDate,
      isAdditional: isAdditional || false,
      hasAddons: hasAddons || false, 
      additionalOptions: additionalOptions || [], 
      accompaniments: accompaniments || [], 
      preparationGroups: preparationGroups || []
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

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID inválido" });
    }

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
                        { 
                          $and: [ 
                                  { $eq: ["$scope","product"] },  
                                  { $eq: ["$productId","$$prodId"] } 
                                ] 
                        },

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
      preparationGroups,
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
      preparationGroups,
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
export const createComboController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params;

    const {
      name,
      price,
      description,
      groups,          // vem do front
      isAvailable,
      image,           // se quiser pegar do body também
    } = req.body ?? {};

    if (!restaurantId) {
      return res.status(400).json({ message: "restaurantId é obrigatório" });
    }

    if (!name) {
      return res.status(400).json({ message: "Nome do combo é obrigatório" });
    }

    const priceNumber = Number(price);
    if (!priceNumber || Number.isNaN(priceNumber) || priceNumber <= 0) {
      return res.status(400).json({ message: "Preço inválido" });
    }

    if (!Array.isArray(groups) || groups.length === 0) {
      return res
        .status(400)
        .json({ message: "Informe ao menos um grupo com opções." });
    }

    // validação rápida dos grupos, no modelo que você já usa no front
    for (const g of groups) {
      if (!g.title?.trim()) {
        return res
          .status(400)
          .json({ message: "Há grupo sem título no combo." });
      }
      if (!Array.isArray(g.options) || g.options.length === 0) {
        return res.status(400).json({
          message: `O grupo "${g.title}" precisa ter pelo menos uma opção.`,
        });
      }
    }

    // se você usa handleIncomingImage, mantém ele aqui
    let imageUrl = image || undefined;
    let imageBlur, imageWidth, imageHeight;

    const imgOut = await handleIncomingImage(req);
    if (imgOut) {
      imageUrl = imgOut.url;
      imageBlur = imgOut.blurDataURL;
      imageWidth = imgOut.width;
      imageHeight = imgOut.height;
    }

    const comboData: any = {
      restaurant: restaurantId,
      name,
      price: priceNumber,
      description,
      image: imageUrl,
      imageBlur,
      imageWidth,
      imageHeight,
      isCombo: true,
      isAvailable: isAvailable !== undefined ? !!isAvailable : true,
      quantity: 1,

      // 👇 AQUI É O PRINCIPAL:
      // usa SEMPRE comboOptions para guardar os grupos do combo
      comboOptions: groups,
    };

    const newCombo = await createProduct(comboData);
    console.log("🔥 DEBUG COMBO createComboController");
    console.log("body.groups:", JSON.stringify(groups, null, 2));
    return res.status(201).json(newCombo);
  } catch (err) {
    console.error("Erro ao criar combo:", err);
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
    const unitIdFromParams = (req.params as any).unitId as string | undefined;

    const {
      name,
      price,
      description,
      comboOptions,   // formato antigo (fallback)
      groups,         // formato novo (preferido)
      isAvailable,
      unitId: unitIdFromBody,
    } = req.body ?? {};

    // Busca o combo atual para manter campos não enviados
    const existing = await getProductById(id);
    if (!existing) {
      return res.status(404).json({ message: "Combo não encontrado" });
    }

    if (!existing.isCombo) {
      return res.status(400).json({ message: "Produto não é um combo" });
    }

    // -----------------------------
    // 1) Tratar grupos / comboOptions
    // -----------------------------
    let finalGroups: any[] | undefined;

    if (Array.isArray(groups)) {
      finalGroups = groups;
    } else if (Array.isArray(comboOptions)) {
      // fallback para chamadas antigas que ainda mandem comboOptions “já no formato novo”
      finalGroups = comboOptions;
    }

    // Se grupos forem enviados, validar minimamente
    if (finalGroups) {
      if (!Array.isArray(finalGroups) || finalGroups.length === 0) {
        return res
          .status(400)
          .json({ message: "Informe ao menos um grupo com opções." });
      }

      for (const g of finalGroups) {
        if (!Array.isArray(g.options) || g.options.length === 0) {
          return res.status(400).json({
            message: `O grupo "${g.title}" precisa ter pelo menos uma opção.`,
          });
        }
      }
    }

    // -----------------------------
    // 2) Tratar preço (se enviado)
    // -----------------------------
    let priceNumber: number | undefined;
    if (price !== undefined) {
      const n = Number(price);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: "Preço inválido" });
      }
      priceNumber = n;
    }

    // -----------------------------
    // 3) Montar payload de atualização
    // -----------------------------
    const effectiveUnitId =
      unitIdFromParams !== undefined ? unitIdFromParams : unitIdFromBody;

    const updatedData: Partial<IProduct> & { isCombo: boolean } = {
      isCombo: true, // garante que continua sendo combo
    };

    if (name !== undefined) {
      updatedData.name = name;
    }

    if (priceNumber !== undefined) {
      updatedData.price = priceNumber;
    }

    if (description !== undefined) {
      updatedData.description = description;
    }

    if (typeof isAvailable === "boolean") {
      updatedData.isAvailable = isAvailable;
    }

    if (effectiveUnitId !== undefined) {
      (updatedData as any).unitId = effectiveUnitId;
    }

    if (finalGroups) {
      // novo formato -> salva em comboOptions
      (updatedData as any).comboOptions = finalGroups;
    }

    // Remove chaves com undefined / string vazia do payload final,
    // só por segurança.
    Object.keys(updatedData).forEach((k) => {
      const v = (updatedData as any)[k];
      if (v === undefined || v === "") {
        delete (updatedData as any)[k];
      }
    });

    // -----------------------------
    // 4) Atualizar no banco
    // -----------------------------
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
    const { restaurantId } = req.params as { restaurantId: string };
    const { unitId } = req.query as { unitId?: string };
    const now = new Date();

    // monta filtro de unidade
    const unitFilter: any = {};
    if (unitId === "null") unitFilter.unit = null;
    else if (unitId)       unitFilter.unit = new Types.ObjectId(unitId);

    // 1) Montar filtro base da promoção
    const promoFilter: any = {
      restaurant: new Types.ObjectId(restaurantId),
      startDate: { $lte: now },
      endDate:   { $gte: now },
      scope: { $in: ["product", "category"] },
    };

    // Regras de unidade:
    // - sem unitId  -> todas as promos (qualquer unit + null)
    // - unitId="null" -> apenas promos globais (unit: null)
    // - unitId=<id>   -> promos dessa unidade OU globais (unit: null)
    if (unitId === "null") {
      promoFilter.unit = null;
    } else if (unitId) {
      const unitObj = new Types.ObjectId(unitId);
      promoFilter.$or = [
        { unit: unitObj },
        { unit: null },
      ];
    }

    // 2) Buscar promoções ativas (produto + categoria)
    const promos = await PromotionModel.find(promoFilter).lean();

    if (!promos.length) return res.status(200).json([]);

    // 2) Coletar productIds de promos por produto
    const productScopePromos = promos.filter(p => p.scope === "product" && p.productId);
    const productIds = productScopePromos.map(p => p.productId).filter(Boolean);

    // 3) Coletar categorias de promos por categoria
    const categoryScopePromos = promos.filter(p => p.scope === "category" && p.category);
    const categories = [...new Set(categoryScopePromos.map(p => p.category).filter(Boolean))];

    // 4) Buscar produtos afetados (por id OU por categoria)
    const or: any[] = [];
    if (productIds.length) or.push({ _id: { $in: productIds } });
    if (categories.length) or.push({ category: { $in: categories } });

    if (!or.length) return res.status(200).json([]);

    const products = await ProductModel.find(
      {
        restaurant: new Types.ObjectId(restaurantId),
        $or: or, // por _id (productIds) ou category (categories)
      },
      { _id: 1, name: 1, price: 1, image: 1, description: 1, category: 1 }
    ).lean();

    // 5) Indexar promos
    const promoByProduct = new Map<string, any>();
    for (const p of productScopePromos) {
      promoByProduct.set(String(p.productId), p);
    }
    const promoByCategory = new Map<string, any>();
    for (const p of categoryScopePromos) {
      // se houver mais de uma por categoria, preferimos a mais recente
      const key = String(p.category);
      if (!promoByCategory.has(key) || p.createdAt > promoByCategory.get(key).createdAt) {
        promoByCategory.set(key, p);
      }
    }

    const numberish = (v: any) => (typeof v === "number" ? v :
                                   typeof v === "string" ? Number(v.replace(",", ".")) : NaN);

    // 6) Montar resultado (produto > categoria)
    const result = products.map(prod => {
      const prodKey = String(prod._id);
      const pPromo  = promoByProduct.get(prodKey);
      const cPromo  = promoByCategory.get(String(prod.category));
      const priceNum = Number((prod as any).price);

      const chosen  = pPromo ?? cPromo ?? null;
      if (!chosen) return prod; // não está realmente em promoção

      const pct   = numberish(chosen.discountPercentage);
      const fixed = numberish(chosen.promotionalPrice);

      const price = numberish(prod.price);
      let finalPrice = price;

      if (Number.isFinite(fixed)) {
        finalPrice = fixed;
      } else if (Number.isFinite(pct) && pct > 0 && Number.isFinite(price)) {
        finalPrice = Math.round(price * (1 - pct / 100) * 100) / 100;
      }

      return {
        ...prod,
        isOnPromotion: true,
        productName: prod.name,
        originalPrice: priceNum,
        discountPercentage: Number.isFinite(pct) ? pct : null,
        promotionalPrice: Number.isFinite(fixed) ? fixed : null,
        promotionStartDate: chosen.startDate ?? null,
        promotionEndDate:   chosen.endDate ?? null,
        finalPrice,
      };
    }).filter(p => (p as any).isOnPromotion); // manter só os que realmente ficaram em promoção

    return res.status(200).json(result);
  } catch (e) {
    console.error("listPromotionalProducts error:", e);
    return res.status(500).json({ message: "Erro ao buscar produto" });
  }
};
