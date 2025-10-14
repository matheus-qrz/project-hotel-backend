// routes/products.ts (ajustado)
import { Router } from "express";
import {
  clearProductPromotionController,
  createComboController,
  createFoodController,
  createMultipleProductsController,
  deleteFoodController,
  getAllFoodsController,
  getFoodByIdController,
  listActivePromotionsController,
  setProductPromotionController,
  updateComboController,
  updateFoodController,
} from "../controllers/ProductController";
import { hasRole, isAuthenticated } from "../middlewares/index";
import { upload } from "../middlewares/multer";
import { importProductsController } from "../controllers/ImportProductsController";

export default (productsRouter: Router) => {
  // Criar produto individual
  productsRouter.post(
    "/restaurant/:id/products",
    upload.single("image"),
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createFoodController
  );

  // Criar múltiplos produtos
  productsRouter.post(
    "/restaurant/:id/products_multi",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createMultipleProductsController
  );

  // Obter todos os produtos de um restaurante
  productsRouter.get(
    "/restaurant/:id/products",
    getAllFoodsController
  );

  // Obter produto específico por ID
  productsRouter.get(
    "/restaurant/:id/products/:id",
    getFoodByIdController
  );

  // Atualizar produto
  productsRouter.patch(
    "/restaurant/:id/products/:id/update",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateFoodController
  );

  // Excluir produto
  productsRouter.delete(
    "/restaurant/:id/products/:id/delete",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deleteFoodController
  );

  productsRouter.post(
    "/restaurant/:id/combos",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createComboController
  );

  // Atualizar combo
  productsRouter.patch(
    "/restaurant/:id/combos/:id/update",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateComboController
  );

  productsRouter.post(
    "/restaurant/:id/products/import",
    isAuthenticated,
    hasRole(["ADMIN","MANAGER"]),
    upload.single("file"),
    importProductsController
  );

  productsRouter.patch(
    "/restaurant/:id/products/:productId/promotion",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    setProductPromotionController
  );

  productsRouter.delete(
    "/restaurant/:id/products/:productId/promotion",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    clearProductPromotionController
  );

  // Listar promoções ativas
  productsRouter.get(
    "/restaurant/:id/promotions/active",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    listActivePromotionsController
  );
};