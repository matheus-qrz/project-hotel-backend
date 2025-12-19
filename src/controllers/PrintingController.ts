import { Request, Response } from "express";
import { PrintJobModel as PrintJob } from "../models/PrintJob";

//
// POST /printing
// (uso interno do backend; idealmente protegido depois)
// OBS: seu fluxo principal já cria jobs via services/printing.ts (enqueuePrintJobsFromOrder)
// então aqui mantemos apenas como endpoint "manual"/debug.
//
export const createPrintJob = async (req: Request, res: Response) => {
  try {
    const {
      restaurantId,
      unitId,
      station,
      orderId,
      tableId,
      action = "NEW_TICKET",
      items = [],
      payload = null,
      idempotencyKey,
    } = req.body ?? {};

    if (!station) return res.status(400).json({ message: "station é obrigatório" });
    if (!action) return res.status(400).json({ message: "action é obrigatório" });

    // Se você for usar este endpoint de verdade, idempotencyKey deve ser obrigatório.
    // Mantive como opcional para não quebrar chamadas antigas, mas recomendo fortemente exigir.
    if (idempotencyKey) {
      // idempotente
      const existing = await PrintJob.findOne({ idempotencyKey }).lean();
      if (existing) return res.status(200).json(existing);
    }

    const created = await PrintJob.create({
      restaurantId: restaurantId ?? null,
      unitId,
      station,
      orderId,
      tableId,
      action,
      items,
      payload,
      idempotencyKey: idempotencyKey ?? undefined,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      sentAt: null,
      claimedAt: null,
    });

    return res.status(201).json(created);
  } catch (err: any) {
    // duplicate key (idempotencyKey unique)
    if (err?.code === 11000 && req.body?.idempotencyKey) {
      const existing = await PrintJob.findOne({ idempotencyKey: req.body.idempotencyKey }).lean();
      if (existing) return res.status(200).json(existing);
    }

    console.error("Erro ao criar print job:", err);
    return res.status(500).json({ message: "Erro ao criar print job" });
  }
};

//
// GET /printing/pending?station=hot&limit=20
// (debug; worker novo deve usar claim)
//
export const getPendingPrintJobs = async (req: Request, res: Response) => {
  if (!req.worker) return res.status(401).end();
  const { restaurantId, unitId, stations } = req.worker as any;

  const { station, limit } = req.query as any;

  const q: any = { status: { $in: ["PENDING", "SENT"] }, restaurantId, unitId };

  if (station) q.station = String(station);
  else if (Array.isArray(stations) && stations.length) q.station = { $in: stations };

  const take = Math.min(Math.max(Number(limit) || 20, 1), 50);

  const jobs = await PrintJob.find(q).sort({ createdAt: 1 }).limit(take).lean();
  return res.json(jobs);
};

//
// PATCH /printing/:id/done
// chamado pelo worker depois que imprimiu
//
export const markPrintJobDone = async (req: Request, res: Response) => {
  if (!req.worker) return res.status(401).end();
  const { restaurantId, unitId } = req.worker as any;

  const job = await PrintJob.findOneAndUpdate(
    { _id: req.params.id, restaurantId, unitId },
    { $set: { status: "PRINTED", lastError: null } },
    { new: true }
  );

  if (!job) return res.status(404).json({ message: "Print job não encontrado no seu escopo" });
  return res.json(job);
};

//
// PATCH /printing/:id/fail
// chamado pelo worker se falhar a impressão
//
export const markPrintJobFailed = async (req: Request, res: Response) => {
  try {
    if (!req.worker) return res.status(401).end();
    const { restaurantId, unitId } = req.worker as any;

    const { errorMessage } = req.body ?? {};

    const job = await PrintJob.findOneAndUpdate(
      { _id: req.params.id, restaurantId, unitId },
      {
        $set: {
          status: "FAILED",
          lastError: errorMessage || "Falha na impressão",
        },
        $inc: { attempts: 1 },
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

//
// PATCH /printing/claim?station=hot&limit=10
// Claim atômico por unidade (evita double-print).
//
export const claimPendingJobs = async (req: Request, res: Response) => {
  if (!req.worker) return res.status(401).end();
  const { restaurantId, unitId, stations } = req.worker as any;

  const { station, limit } = req.query as any;

  const stationFilter =
    station
      ? { station: String(station) }
      : Array.isArray(stations) && stations.length
        ? { station: { $in: stations } }
        : {};

  const take = Math.min(Math.max(Number(limit) || 10, 1), 50);

  // 1) pega em lote os PENDING
  const jobs = await PrintJob.find({
    restaurantId,
    unitId,
    status: "PENDING",
    ...stationFilter,
  })
    .sort({ createdAt: 1 })
    .limit(take);

  const ids = jobs.map((j: any) => j._id);

  // 2) marca como SENT (claim)
  if (ids.length) {
    await PrintJob.updateMany(
      { _id: { $in: ids }, status: "PENDING", restaurantId, unitId },
      {
        $set: { status: "SENT", claimedAt: new Date(), lastError: null },
        $inc: { attempts: 1 },
      }
    );
  }

  // 3) devolve já como "SENT" (evita retorno “stale”)
  const claimed = ids.length
    ? await PrintJob.find({ _id: { $in: ids } }).sort({ createdAt: 1 }).lean()
    : [];

  return res.json(claimed);
};
