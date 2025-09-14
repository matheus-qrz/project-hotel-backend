import { Router } from "express";
import { getPublicAttendantForTable, putBulkRangeAssignments } from '../controllers/RangeAssignmentController';
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  // Público (cliente/QR): agora “manager”
  router.get("/public/units/:unitId/tables/:tableId/manager", getPublicAttendantForTable);

  // (Compat opcional por um tempo)
  router.get("/public/units/:unitId/tables/:tableId/attendant", getPublicAttendantForTable);

  // Somente MANAGER pode aplicar escala
  router.patch(
    "/units/:unitId/range-assignments/bulk",
    isAuthenticated,
    hasRole(["ADMIN","MANAGER"]),
    putBulkRangeAssignments
  );
};
