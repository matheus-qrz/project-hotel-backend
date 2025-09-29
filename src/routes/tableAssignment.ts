import { Router } from "express";
import { getPublicAttendantForTable, putBulkTableAssignments, seedTableAssignmentsFromRanges } from "../controllers/TableAssignmentController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (tableAssignmentRouter: Router) => {
  // Público (usado na tela do cliente que abre via QR)
  tableAssignmentRouter.get("/public/units/:unitId/tables/:tableId/attendant", getPublicAttendantForTable);

  // Gerente atribui em lote (ex.: mesas 1-10 -> Fulano)
  tableAssignmentRouter.patch(
    "/units/:unitId/table-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN","MANAGER"]),
    putBulkTableAssignments
  );

  tableAssignmentRouter.post(
  "/manager/units/:unitId/seed-table-assignments",
  isAuthenticated,
  hasRole(["ADMIN","MANAGER"]),
  seedTableAssignmentsFromRanges
  );
};
