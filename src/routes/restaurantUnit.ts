import { Router } from "express";
import {
  addRestaurantUnitController,
  deleteRestaurantUnitController,
  getAllRestaurantUnitsController,
  getRestaurantUnitByIdController,
  updateRestaurantUnitController,
  addAttendantToUnitController,
  removeAttendantFromUnitController
} from "../controllers/restaurantUnitController";
import { hasRole, isAuthenticated } from "../middlewares/index";
import { getRestaurantUnitOrdersController } from "../controllers/OrderController";

export default (restaurantUnitRouter: Router) => {
  restaurantUnitRouter.post(
    "/restaurant/:restaurantId/units/register",
    isAuthenticated,
    hasRole(["ADMIN"]),
    addRestaurantUnitController
  );

  // Para múltiplas roles
  restaurantUnitRouter.get(
    "/units/:unitId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    getRestaurantUnitByIdController
  );

  // Para rotas que requerem roles específicas
  restaurantUnitRouter.post(
    "/units/:unitId/attendant",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    addAttendantToUnitController
  );

  // Obter todas as unidades de um restaurante
  restaurantUnitRouter.get(
    "/restaurant/:restaurantId/units",
    isAuthenticated,
    hasRole("ADMIN"),
    getAllRestaurantUnitsController
  );

  // Atualizar uma unidade
  restaurantUnitRouter.patch(
    "/units/:unitId",
    isAuthenticated,
    hasRole("ADMIN"),
    updateRestaurantUnitController
  );

  // Excluir uma unidade
  restaurantUnitRouter.delete(
    "/units/:unitId/restaurant/:restaurantId",
    isAuthenticated,
    hasRole("ADMIN"),
    deleteRestaurantUnitController
  );

  // Obter pedidos de uma unidade
  restaurantUnitRouter.get(
    "/units/:unitId/order",
    isAuthenticated,
    getRestaurantUnitOrdersController
  );

  // Remover atendente de uma unidade
  restaurantUnitRouter.delete(
    "/units/:unitId/attendant/:attendantId",
    isAuthenticated,
    hasRole("ADMIN"),
    removeAttendantFromUnitController
  );
};