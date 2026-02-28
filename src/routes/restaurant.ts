import { Router } from "express";
import {
  getAllRestaurantsController,
  getRestaurantByIdController,
  updateRestaurantController,
  deleteRestaurantController,
  getRestaurantBySlugController,
} from "../controllers/RestaurantController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  // Rotas públicas
  router.get("/restaurant", getAllRestaurantsController);
  router.get("/restaurant/:id", getRestaurantByIdController);
  router.get("/restaurant/by-slug/:slug", getRestaurantBySlugController);

  // Rotas protegidas (requerem autenticação de restaurante)
  router.patch(
    "/restaurant/:id",
    isAuthenticated,
    hasRole(['ADMIN', 'MANAGER']),
    updateRestaurantController
  );

  router.delete(
    "/restaurant/:id",
    isAuthenticated,
    hasRole(['ADMIN', 'MANAGER']),
    deleteRestaurantController
  );

  return router;
};