import { Router, Request, Response, NextFunction } from "express";
import {
  listRangeAssignments,
  createOrMergeRangeAssignment,
  replaceDays,
  toggleActive,
  updateRangeAssignment,
  deleteRangeAssignment,
} from "../controllers/RangeAssignmentController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  /**
   * LISTAR escalas agregadas por unidade (ADMIN/MANAGER)
   * Usa o novo agregador que já unifica dias (compat com legados).
   */
  router.get(
    "/units/:unitId/range-assignments",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"])
  );

  /**
   * CRIAR/MESCLAR uma escala única (daysOfWeek[] em um doc)
   * Compat: o antigo "bulk" agora mapeia para este mesmo handler.
   */
  router.post(
    "/units/:unitId/range-assignments",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"])
  );

  // Compat com endpoint antigo de "aplicar intervalo em bulk"
  router.patch(
    "/units/:unitId/range-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"])
  );

  // (Opcional) compat por restaurante/matriz, se ainda houver chamadas antigas:
  router.patch(
    "/restaurants/:restaurantId/range-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"])
  );

  /**
   * EDITAR campos gerais de uma escala (sem trocar dias)
   */
  router.patch(
    "/range-assignments/:id",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateRangeAssignment
  );

  /**
   * SUBSTITUIR completamente os dias de uma escala (daysOfWeek)
   */
  router.patch(
    "/range-assignments/:id/days",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    replaceDays
  );

  /**
   * ATIVAR/DESATIVAR uma escala
   */
  router.patch(
    "/range-assignments/:id/toggle",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    toggleActive
  );

  /**
   * REMOVER uma escala
   */
  router.delete(
    "/range-assignments/:id",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deleteRangeAssignment
  );
};
