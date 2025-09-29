import { Router } from "express";
import {
  listRangeAssignments,
  createOrMergeRangeAssignment,
  replaceDays,
  toggleActive,
  updateRangeAssignment,
  deleteRangeAssignment,
  reassignTablesController,
} from "../controllers/RangeAssignmentController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (rangeAssignRouter: Router) => {
  /**
   * LISTAR escalas agregadas por unidade (ADMIN/MANAGER)
   * Usa o novo agregador que já unifica dias (compat com legados).
   */
  rangeAssignRouter.get(
    "/units/:unitId/range-assignments",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]), 
    listRangeAssignments
  );

  /**
   * CRIAR/MESCLAR uma escala única (daysOfWeek[] em um doc)
   * Compat: o antigo "bulk" agora mapeia para este mesmo handler.
   */
  rangeAssignRouter.post(
    "/units/:unitId/range-assignments",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
      createOrMergeRangeAssignment
  );

  // Compat com endpoint antigo de "aplicar intervalo em bulk"
  rangeAssignRouter.patch(
    "/units/:unitId/range-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createOrMergeRangeAssignment
  );

  // (Opcional) compat por restaurante/matriz, se ainda houver chamadas antigas:
  rangeAssignRouter.patch(
    "/restaurants/:restaurantId/range-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createOrMergeRangeAssignment
  );

  /**
   * EDITAR campos gerais de uma escala (sem trocar dias)
   */
  rangeAssignRouter.patch(
    "/range-assignments/:id",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateRangeAssignment
  );

  /**
   * SUBSTITUIR completamente os dias de uma escala (daysOfWeek)
   */
  rangeAssignRouter.patch(
    "/range-assignments/:id/days",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    replaceDays
  );

  /**
   * ATIVAR/DESATIVAR uma escala
   */
  rangeAssignRouter.patch(
    "/range-assignments/:id/toggle",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    toggleActive
  );

  /**
   * REMOVER uma escala
   */
  rangeAssignRouter.delete(
    "/range-assignments/:id",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deleteRangeAssignment
  );

  /** 
   * ALTERAR ESCALA 
  */
  rangeAssignRouter.post("/reassign",
  isAuthenticated,
  hasRole(["ADMIN", "MANAGER"]),
  reassignTablesController);
};
