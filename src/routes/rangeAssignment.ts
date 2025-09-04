import { Router } from "express";
import { getPublicManagerForTable, putBulkRangeAssignments } from "../controllers/RangeAssignmentController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  // Público (cliente/QR): agora “manager”
  router.get("/public/units/:unitId/tables/:tableId/manager", getPublicManagerForTable);

  // (Compat opcional por um tempo)
  router.get("/public/units/:unitId/tables/:tableId/attendant", getPublicManagerForTable);

  // Somente MANAGER pode aplicar escala
  router.put(
    "/units/:unitId/range-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN","MANAGER"]),
    putBulkRangeAssignments
  );
};
