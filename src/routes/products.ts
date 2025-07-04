// routes/products.ts (ajustado)
import { Router } from "express";
import {
  createComboController,
  createFoodController,
  createMultipleProductsController,
  deleteFoodController,
  getAllFoodsController,
  getFoodByIdController,
  updateComboController,
  updateFoodController,
} from "../controllers/ProductController";
import { hasRole, isAuthenticated } from "../middlewares/index";
import { upload } from "../middlewares/multer";

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
};