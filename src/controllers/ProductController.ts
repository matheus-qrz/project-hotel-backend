import express from "express";
import {
  createProduct,
  deleteProduct,
  getProductById,
  getProductByName,
  getProductsByRestaurant,
  updateProduct
} from "../models/Products";
import { parseDataURL } from "../utils/parseDataURL";
import { processAndSaveProductImage } from "../infra/image";
import { IProduct } from "../models";

async function handleIncomingImage(req: express.Request) {
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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

export const updateFoodController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const {
      name,
      category,
      price,
      description,
      image,
      isAvailable,
      isOnPromotion,
      discountPercentage,
      promotionalPrice,
      promotionStartDate,
      promotionEndDate,
      isAdditional,
      additionalOptions
    } = req.body;

    // Verificar se o produto existe
    const existingProduct = await getProductById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    // Cálculo do preço promocional se fornecido desconto
    let calculatedPromotionalPrice = promotionalPrice;
    if (isOnPromotion && discountPercentage && !promotionalPrice) {
      calculatedPromotionalPrice = price - (price * (discountPercentage / 100));
    }

    const updatedData = {
      name,
      category,
      price,
      description,
      image,
      isAvailable,
      isOnPromotion: isOnPromotion || false,
      ...(isOnPromotion ? {
        discountPercentage,
        promotionalPrice: calculatedPromotionalPrice,
        promotionStartDate,
        promotionEndDate
      } : {
        discountPercentage: null,
        promotionalPrice: null,
        promotionStartDate: null,
        promotionEndDate: null
      }),
      isAdditional: isAdditional || false,
      additionalOptions
    };

    const updatedProduct = await updateProduct(id, updatedData);
    return res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Erro ao atualizar produto:", error);
    return res.status(500).json({ message: "Erro ao atualizar produto" });
  }
};

export const deleteFoodController = async (
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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
  req: express.Request,
  res: express.Response
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