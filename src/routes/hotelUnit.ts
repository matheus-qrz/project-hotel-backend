import { Router } from "express";
import {
  addHotelUnitController,
  deleteHotelUnitController,
  getAllHotelUnitsController,
  getHotelUnitByIdController,
  updateHotelUnitController,
  addAttendantToUnitController,
  removeAttendantFromUnitController
} from "../controllers/HotelUnitController";
import { getRestaurantUnitOrdersController } from "../controllers/OrderController";
import { hasRole, isAuthenticated } from "../middlewares/index";

export default (hotelUnitRouter: Router) => {
  // Criar nova unidade de hotel
  hotelUnitRouter.post(
    "/hotel/:hotelId/units/register",
    isAuthenticated,
    hasRole(["ADMIN"]),
    addHotelUnitController
  );

  // Obter unidade por ID
  hotelUnitRouter.get(
    "/units/:unitId",
    getHotelUnitByIdController
  );

  // Adicionar atendente a unidade
  hotelUnitRouter.post(
    "/units/:unitId/attendant",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    addAttendantToUnitController
  );

  // Obter todas as unidades de um hotel
  hotelUnitRouter.get(
    "/hotel/:hotelId/units",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    getAllHotelUnitsController
  );

  // Atualizar uma unidade
  hotelUnitRouter.patch(
    "/units/:unitId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateHotelUnitController
  );

  // Excluir uma unidade
  hotelUnitRouter.delete(
    "/units/:unitId/hotel/:hotelId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deleteHotelUnitController
  );

  // Obter pedidos de uma unidade
  hotelUnitRouter.get(
    "/units/:unitId/order",
    hasRole(["ADMIN","MANAGER"]),
    isAuthenticated,
    getRestaurantUnitOrdersController
  );

  // Remover atendente de uma unidade
  hotelUnitRouter.delete(
    "/units/:unitId/attendant/:attendantId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    removeAttendantFromUnitController
  );

  // === Alias para compatibilidade com rotas antigas /restaurant ===
  hotelUnitRouter.post(
    "/restaurant/:restaurantId/units/register",
    isAuthenticated,
    hasRole(["ADMIN"]),
    addHotelUnitController
  );

  hotelUnitRouter.get(
    "/restaurant/:restaurantId/units",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    getAllHotelUnitsController
  );

  hotelUnitRouter.delete(
    "/units/:unitId/restaurant/:restaurantId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deleteHotelUnitController
  );
};
