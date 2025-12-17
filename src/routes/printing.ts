import { Router } from "express";
import {
  claimPendingJobs,
  createPrintJob,
  getPendingPrintJobs,
  markPrintJobDone,
  markPrintJobFailed,
} from "../controllers/PrintingController";
import { workerAuth } from "../middlewares/workerAuth";

export default(printingRouter: Router) => {
    // criar job (quem chama é o próprio sistema, não o worker)
    printingRouter.post("/printing", createPrintJob);

    // worker busca pendentes
    printingRouter.get("/printing/pending", workerAuth, getPendingPrintJobs);

    // worker marca como impresso
    printingRouter.patch("/printing/:id/done", workerAuth, markPrintJobDone);

    // worker marca como falho
    printingRouter.patch("/printing/:id/fail", workerAuth, markPrintJobFailed);

    // claim atomico
    printingRouter.patch("/printing/claim", workerAuth, claimPendingJobs);
};