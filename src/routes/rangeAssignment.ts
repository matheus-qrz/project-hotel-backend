import { Router } from "express";
import { getPublicAttendantForTable, putBulkRangeAssignments } from "../controllers/RangeAssignmentController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (router: Router) => {
  // público (cliente via QR)
  router.get("/public/units/:unitId/tables/:tableId/attendant", getPublicAttendantForTable);

  // manager agenda/atribui intervalos
  router.put("/units/:unitId/range-assignments/bulk",
    isAuthenticated, hasRole(["MANAGER"]), putBulkRangeAssignments);
};
