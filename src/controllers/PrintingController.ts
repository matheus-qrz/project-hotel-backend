import { Request, Response } from "express";
import { PrintJobModel as PrintJob } from "../models/PrintJob";

/**
 * Convenções:
 * - attempts = número de tentativas reais de impressão (incrementa no CLAIM, não no FAIL/DONE)
 * - status:
 *   PENDING -> SENT (claimed) -> PRINTED | FAILED
 * - claim também re-claim jobs SENT “órfãos” (worker caiu) após TTL
 */

const CLAIM_TTL_MS = Math.max(Number(process.env.PRINT_CLAIM_TTL_MS || 120000), 10_000); // default 2min
const MAX_BATCH = 50;

function getWorkerScope(req: Request) {
  const w = (req as any).worker;
  if (!w) return null;

  const { restaurantId, unitId, stations } = w as any;
  return {
    restaurantId,
    unitId: unitId ?? null,
    stations: Array.isArray(stations) ? stations : [],
  };
}

function buildStationFilter(req: Request, workerStations: string[]) {
  const { station } = req.query as any;

  if (station) return { station: String(station) };
  if (workerStations?.length) return { station: { $in: workerStations } };
  return {};
}

/**
 * POST /printing
 * endpoint "manual"/debug. O fluxo normal é via services/printing.ts (enqueuePrintJobsFromOrder).
 */
export const createPrintJob = async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    if (body?.idempotencyKey) {
      const existing = await PrintJob.findOne({ idempotencyKey: body.idempotencyKey }).lean();
      if (existing) return res.status(200).json(existing);
    }

    const created = await PrintJob.create(body);
    return res.status(201).json(created);
  } catch (err: any) {
    console.error("Erro ao criar print job:", err);
    return res.status(500).json({ message: "Erro ao criar print job" });
  }
};

/**
 * GET /printing/pending
 * debug — o worker deve usar CLAIM.
 */
export const getPendingPrintJobs = async (req: Request, res: Response) => {
  const scope = getWorkerScope(req);
  if (!scope) return res.status(401).end();

  const { restaurantId, unitId, stations } = scope;

  const { limit } = req.query as any;
  const take = Math.min(Math.max(Number(limit) || 20, 1), MAX_BATCH);

  const stationFilter = buildStationFilter(req, stations);

  // apenas PENDING (debug)
  const q: any = {
    restaurantId,
    unitId,
    status: "PENDING",
    ...stationFilter,
  };

  const jobs = await PrintJob.find(q).sort({ createdAt: 1 }).limit(take).lean();
  return res.json(jobs);
};

/**
 * PATCH /printing/:id/done
 * worker confirma que imprimiu
 */
export const markPrintJobDone = async (req: Request, res: Response) => {
  try {
    const scope = getWorkerScope(req);
    if (!scope) return res.status(401).end();

    const { restaurantId, unitId } = scope;

    const job = await PrintJob.findOneAndUpdate(
      { _id: req.params.id, restaurantId, unitId },
      {
        $set: {
          status: "PRINTED",
          lastError: null,
          // opcional: manter rastreio
          sentAt: new Date(),
        },
      },
      { new: true }
    );

    if (!job) return res.status(404).json({ message: "Print job não encontrado no seu escopo" });
    return res.json(job);
  } catch (err: any) {
    console.error("Erro ao marcar como done:", err);
    return res.status(500).json({ message: "Erro ao marcar como done" });
  }
};

/**
 * PATCH /printing/:id/fail
 * worker informa erro (sem incrementar attempts aqui — attempts incrementa no CLAIM)
 */
export const markPrintJobFailed = async (req: Request, res: Response) => {
  try {
    const scope = getWorkerScope(req);
    if (!scope) return res.status(401).end();

    const { restaurantId, unitId } = scope;

    // compat: worker atual manda { reason }, mas também aceitamos { errorMessage }
    const { errorMessage, reason } = req.body ?? {};
    const msg = String(errorMessage || reason || "Falha na impressão");

    const job = await PrintJob.findOneAndUpdate(
      { _id: req.params.id, restaurantId, unitId },
      {
        $set: {
          status: "FAILED",
          lastError: msg,
        },
      },
      { new: true }
    );

    if (!job) return res.status(404).json({ message: "Print job não encontrado no seu escopo" });
    return res.json(job);
  } catch (err: any) {
    console.error("Erro ao marcar como fail:", err);
    return res.status(500).json({ message: "Erro ao marcar como fail" });
  }
};

/**
 * PATCH /printing/claim?station=hot&limit=10
 * Claim ATÔMICO por job (evita double print).
 * Também re-claim jobs SENT órfãos (claimedAt antigo) após TTL.
 */
export const claimPendingJobs = async (req: Request, res: Response) => {
  const scope = getWorkerScope(req);
  if (!scope) return res.status(401).end();

  const { restaurantId, unitId, stations } = scope;
  const { limit } = req.query as any;

  const take = Math.min(Math.max(Number(limit) || 10, 1), MAX_BATCH);
  const stationFilter = buildStationFilter(req, stations);

  const now = new Date();
  const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);

  // Regras:
  // - pega PENDING
  // - ou SENT “stale” (worker morreu) => claimedAt <= staleBefore
  // - sempre do escopo restaurantId + unitId
  // - opcionalmente por station (query ou stations do worker)
  const baseMatch: any = {
    restaurantId,
    unitId,
    ...stationFilter,
    $or: [
      { status: "PENDING" },
      { status: "SENT", claimedAt: { $lte: staleBefore } },
    ],
  };

  const claimed: any[] = [];

  for (let i = 0; i < take; i++) {
    const job = await PrintJob.findOneAndUpdate(
      baseMatch,
      {
        $set: {
          status: "SENT",
          claimedAt: now,
          sentAt: now,
          lastError: null,
        },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, new: true }
    ).lean();

    if (!job) break;
    claimed.push(job);
  }

  return res.json(claimed);
};
