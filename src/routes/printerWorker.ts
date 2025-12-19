import { Router } from "express";
import {
  createPrinterWorkerController,
  listPrinterWorkersController,
  revokePrinterWorkerController,
} from "../controllers/PrinterWorkerController";
import { isAuthenticated } from "../middlewares/auth";
import { hasRole } from "../middlewares/hasRole";

export default (router: Router) => {
  router.get(
    "/printer-worker",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    listPrinterWorkersController
  );

  router.post(
    "/printer-worker",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createPrinterWorkerController
  );

  router.patch(
    "/printer-worker/:id/revoke",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    revokePrinterWorkerController
  );
};
