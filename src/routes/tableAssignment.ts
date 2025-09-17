import { Router } from "express";
import { getPublicAttendantForTable, putBulkTableAssignments, seedTableAssignmentsFromRanges } from "../controllers/TableAssignmentController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  // Público (usado na tela do cliente que abre via QR)
  router.get("/public/units/:unitId/tables/:tableId/attendant", getPublicAttendantForTable);

  // Gerente atribui em lote (ex.: mesas 1-10 -> Fulano)
  router.patch(
    "/units/:unitId/table-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN","MANAGER"]),
    putBulkTableAssignments
  );

  router.post(
  "/manager/units/:unitId/seed-table-assignments",
  isAuthenticated,
  hasRole(["MANAGER", "ADMIN"]),
  seedTableAssignmentsFromRanges
);
};
