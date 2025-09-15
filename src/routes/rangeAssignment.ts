import { Router } from "express";
import { getPublicAttendantForTable, listRangeAssignments, putBulkRangeAssignments } from '../controllers/RangeAssignmentController';
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  // Público (cliente/QR): agora “manager”
  router.get("/public/units/:unitId/tables/:tableId/manager", getPublicAttendantForTable);

  // (Compat opcional por um tempo)
  router.get("/public/units/:unitId/tables/:tableId/attendant", getPublicAttendantForTable);

  // listar escalas da unidade (ADMIN/MANAGER) ***
  router.get(
    "/units/:unitId/range-assignments",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    listRangeAssignments
  );

  // Somente MANAGER pode aplicar escala
  router.patch("/restaurants/:restaurantId/range-assignments/bulk", isAuthenticated, hasRole(["ADMIN","MANAGER"]), putBulkRangeAssignments);
  router.patch("/units/:unitId/range-assignments/bulk",        isAuthenticated, hasRole(["ADMIN","MANAGER"]), putBulkRangeAssignments);
};
