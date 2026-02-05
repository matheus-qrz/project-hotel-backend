import { Router } from "express";
import {
  getAllHotelsController,
  getHotelByIdController,
  updateHotelController,
  deleteHotelController,
  getHotelBySlugController,
} from "../controllers/HotelController";
import { isAuthenticated, isHotelAdmin } from "../middlewares";

export default (router: Router) => {
  // Rotas publicas
  router.get("/hotel", getAllHotelsController);
  router.get("/hotel/:id", getHotelByIdController);
  router.get("/hotel/by-slug/:slug", getHotelBySlugController);

  // Rotas protegidas (requerem autenticacao de hotel)
  router.patch(
    "/hotel/:id",
    isAuthenticated,
    isHotelAdmin,
    updateHotelController
  );

  router.delete(
    "/hotel/:id",
    isAuthenticated,
    isHotelAdmin,
    deleteHotelController
  );

  // Alias para compatibilidade com rotas antigas /restaurant
  router.get("/restaurant", getAllHotelsController);
  router.get("/restaurant/:id", getHotelByIdController);
  router.get("/restaurant/by-slug/:slug", getHotelBySlugController);
  router.patch(
    "/restaurant/:id",
    isAuthenticated,
    isHotelAdmin,
    updateHotelController
  );
  router.delete(
    "/restaurant/:id",
    isAuthenticated,
    isHotelAdmin,
    deleteHotelController
  );

  return router;
};
