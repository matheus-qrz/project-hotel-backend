import { Request, Response} from "express";
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

function parseMoneyField(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;

  if (typeof val === "number") return val;

  if (typeof val === "string") {
    // remove tudo que não for dígito, vírgula ou ponto
    const normalized = val
      .replace(/[^\d.,-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(normalized);
    return Number.isNaN(n) ? null : n;
  }

  return null;
}

function parseBooleanField(val: any, defaultValue = false): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1;
  if (typeof val === "string") {
    return ["true", "1", "on", "yes"].includes(val.toLowerCase());
  }
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
  console.log("file:", req.file?.originalname, req.file?.mimetype, req.file?.size);

  return null;
}

export const createFoodController = async (
  req: Request,
  res: Response
) => {
  const start = Date.now();

  try {
    const { id: restaurantId } = req.params;
    if (!restaurantId) {
      return res
        .status(400)
        .json({ message: "restaurantId é obrigatório" });
    }

    // req.body aqui é any (vindo de JSON ou multipart/form-data)
    const {
      name,
      category,
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
      isAdditional,
      hasAddons,
      additionalOptions,
      accompaniments,
      preparationGroups,
      isCombo,
      comboOptions,
    } = req.body as any;

    // Campos obrigatórios
    if (!name || !category) {
      return res
        .status(400)
        .json({ message: "Campos obrigatórios ausentes" });
    }

    // Converter preço (vem string no FormData)
    const priceNumber = parseMoneyField(price);
    if (priceNumber === null || priceNumber <= 0) {
      return res.status(400).json({ message: "Preço inválido" });
    }

    const costPriceNumber = parseMoneyField(costPrice);
    const quantityNumber =
      quantity !== undefined && quantity !== null && quantity !== ""
        ? Number(quantity)
        : 0;

    // Verificar duplicidade por nome
    const sameName = await getProductByName(name);
    if (sameName) {
      return res
        .status(400)
        .json({ message: "Já existe um produto com este nome" });
    }

    // Tratamento de imagem
    let imageUrl: string | undefined;
    let imageBlur: string | undefined;
    let imageWidth: number | undefined;
    let imageHeight: number | undefined;

    const imgOut = await handleIncomingImage(req);
    if (imgOut) {
      imageUrl = imgOut.url;
      imageBlur = imgOut.blurDataURL;
      imageWidth = imgOut.width;
      imageHeight = imgOut.height;
    } else if (imageFromBody) {
      imageUrl = imageFromBody;
    }

    // promo flags
    const isOnPromotionBool = parseBooleanField(isOnPromotion, false);
    const discountNumber =
      discountPercentage !== undefined && discountPercentage !== null && discountPercentage !== ""
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

    // parse de arrays/objetos (vindos como JSON string no FormData)
    const additionalOptionsParsed =
      parseJSONField<any[]>(additionalOptions) ?? additionalOptions ?? [];
    const accompanimentsParsed =
      parseJSONField<any[]>(accompaniments) ?? accompaniments ?? [];
    const preparationGroupsParsed =
      parseJSONField<any[]>(preparationGroups) ?? preparationGroups ?? [];
    const comboOptionsParsed =
      parseJSONField<any[]>(comboOptions) ?? comboOptions ?? [];

    // Monta payload compatível com o model (sem tipar como IProduct)
    const productData: Record<string, any> = {
      restaurant: restaurantId,
      name,
      category,
      description: description ?? "",
      price: priceNumber,
      // IProduct.image é string obrigatória -> garante string (nem que seja "")
      image: imageUrl ?? "",
      imageBlur,
      imageWidth,
      imageHeight,
      quantity: Number.isNaN(quantityNumber) ? 0 : quantityNumber,
      // IProduct.costPrice é number -> garante number (0 se não veio nada)
      costPrice: costPriceNumber ?? 0,
      isAvailable: parseBooleanField(isAvailable, true),

      isOnPromotion: isOnPromotionBool,
      discountPercentage:
        discountNumber !== null && !Number.isNaN(discountNumber)
          ? discountNumber
          : null,
      promotionalPrice: finalPromoPrice,
      promotionStartDate: promotionStartDate
        ? new Date(promotionStartDate)
        : null,
      promotionEndDate: promotionEndDate ? new Date(promotionEndDate) : null,

      isAdditional: parseBooleanField(isAdditional, false),
      hasAddons: parseBooleanField(hasAddons, false),

      // model espera array de subdocs { id, name, price, isAvailable }
      additionalOptions: additionalOptionsParsed,

      // model usa array de accompaniments
      accompaniments: accompanimentsParsed,

      // groups de preparo (ponto da carne etc.)
      preparationGroups: preparationGroupsParsed,

      // combos
      isCombo: parseBooleanField(isCombo, false),
      comboOptions: comboOptionsParsed,
    };

    const newFood = await createProduct(productData);

    const total = Date.now() - start;
    console.log(
      `[createFoodController] restaurante=${restaurantId} nome="${name}" levou ${total}ms`,
    );

    return res.status(201).json(newFood);
  } catch (error) {
    const total = Date.now() - start;
    console.error(
      "[createFoodController] erro após",
      total,
      "ms:",
      error,
    );
    return res
      .status(500)
      .json({ message: "Erro ao criar produto" });
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
      groups,        // formato novo
      comboOptions,  // fallback formato antigo
      isAvailable,
      image,         // URL vinda do front (ex: "/uploads/products/.../original.jpg")
      unitId,
    } = req.body ?? {};

    if (!restaurantId) {
      return res.status(400).json({ message: "restaurantId é obrigatório" });
    }

    if (!name) {
      return res.status(400).json({ message: "Nome do combo é obrigatório" });
    }

    // -----------------------------
    // 1) Tratar grupos / comboOptions
    // -----------------------------
    let finalGroups: any[] | undefined;

    if (Array.isArray(groups)) {
      finalGroups = groups;
    } else if (Array.isArray(comboOptions)) {
      finalGroups = comboOptions;
    }

    if (!finalGroups || !Array.isArray(finalGroups) || finalGroups.length === 0) {
      return res
        .status(400)
        .json({ message: "Informe ao menos um grupo com opções." });
    }

    for (const g of finalGroups) {
      if (!g.title || !String(g.title).trim()) {
        return res.status(400).json({ message: "Há grupo sem título." });
      }
      if (!Array.isArray(g.options) || g.options.length === 0) {
        return res.status(400).json({
          message: `O grupo "${g.title}" precisa ter pelo menos uma opção.`,
        });
      }
    }
    
    // -----------------------------
    // 2) Tratar preço
    // -----------------------------
    const nPrice = Number(price);
    if (!Number.isFinite(nPrice) || nPrice <= 0) {
      return res.status(400).json({ message: "Preço inválido" });
    }
    
    // -----------------------------
    // 3) Tratar imagem
    // -----------------------------
    let imageUrl: string | undefined;
    let imageBlur: string | undefined;
    let imageWidth: number | undefined;
    let imageHeight: number | undefined;
    
    const imgOut = await handleIncomingImage(req);
    if (imgOut) {
      imageUrl = imgOut.url;
      imageBlur = imgOut.blurDataURL;
      imageWidth = imgOut.width;
      imageHeight = imgOut.height;
    } else if (typeof image === "string" && image.trim().length > 0) {
      imageUrl = image.trim();
    }

    // 4) Montar dados do combo
    // -----------------------------
    const comboData: Partial<IProduct> & { isCombo: boolean } = {
      isCombo: true,
      restaurant: restaurantId as any,
      name: String(name),
      description: description ?? "",
      price: nPrice,
      isAvailable:
        typeof isAvailable === "boolean" ? isAvailable : true,
    };

    if (imageUrl) {
      comboData.image = imageUrl;
      (comboData as any).imageBlur = imageBlur;
      (comboData as any).imageWidth = imageWidth;
      (comboData as any).imageHeight = imageHeight;
    }

    if (unitId) {
      (comboData as any).unitId = unitId;
    }

    // -----------------------------
    // 4) Criar no banco
    // -----------------------------
    const newCombo = await createProduct(comboData as any);
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
    const { comboId, restaurantId } = req.params as any;
    const id = comboId;
    const unitIdFromParams = (req.params as any).unitId as string | undefined;

    const {
      name,
      price,
      description,
      comboOptions, 
      groups,       
      isAvailable,
      unitId: unitIdFromBody,
      image,       
    } = req.body ?? {};

    const isAvailableBool =
      typeof isAvailable === "boolean"
        ? isAvailable
        : typeof isAvailable === "string"
          ? isAvailable === "true"
          : undefined;

    const parseMaybeJson = (v: any) => {
      if (typeof v === "string") {
        const s = v.trim();
        if (!s) return undefined;
        try { return JSON.parse(s); } catch { return v; }
      }
      return v;
    };

    const parsedGroups = parseMaybeJson(groups);
    const parsedComboOptions = parseMaybeJson(comboOptions);
    

    // 1) Buscar combo atual
    const existing = await getProductById(id);
    if (!existing) {
      return res.status(404).json({ message: "Combo não encontrado" });
    }

    if (!existing.isCombo) {
      return res.status(400).json({ message: "Produto não é um combo" });
    }

    // 2) Tratar grupos / comboOptions
    let finalGroups: any[] | undefined;
    if (Array.isArray(parsedGroups)) finalGroups = parsedGroups;
    else if (Array.isArray(parsedComboOptions)) finalGroups = parsedComboOptions;

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

    // 3) Tratar preço (se enviado)
    let priceNumber: number | undefined;
    if (price !== undefined) {
      const n = Number(price);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: "Preço inválido" });
      }
      priceNumber = n;
    }


    // 4) Montar payload de atualização
    const effectiveUnitId =
      unitIdFromParams !== undefined ? unitIdFromParams : unitIdFromBody;

    // 5) Tratar imagem (arquivo ou string)
    const imgOut = await handleIncomingImage(req);

    const updatedData: Partial<IProduct> & { isCombo: boolean } = {
      isCombo: true,
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

    if (isAvailableBool !== undefined) {
      updatedData.isAvailable = isAvailableBool;
    }

    if (effectiveUnitId !== undefined) {
      (updatedData as any).unitId = effectiveUnitId;
    }

    if (finalGroups) (updatedData as any).comboOptions = finalGroups;

    if (imgOut) {
      updatedData.image = imgOut.url;
      (updatedData as any).imageBlur = imgOut.blurDataURL;
      (updatedData as any).imageWidth = imgOut.width;
      (updatedData as any).imageHeight = imgOut.height;
    } else if (typeof image === "string" && image.trim()) {
      updatedData.image = image.trim();
    }

    // 5) Limpar campos undefined / string vazia
    Object.keys(updatedData).forEach((k) => {
      const v = (updatedData as any)[k];
      if (v === undefined || v === "") delete (updatedData as any)[k];
    });

    // 6) Atualizar no banco
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
