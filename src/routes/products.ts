// routes/products.ts (ajustado)
import { Router } from "express";
import {
  createFoodController,
  createMultipleProductsController,
  deleteFoodController,
  getAllFoodsController,
  getFoodByIdController,
  updateFoodController,
} from "../controllers/ProductController.ts";
import { hasRole, isAuthenticated } from "../middlewares/index.ts";
import { upload } from "../middlewares/multer.ts";

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
};