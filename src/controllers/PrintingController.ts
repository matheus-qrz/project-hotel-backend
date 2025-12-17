import { Request, Response } from "express";
import { PrintJobModel as PrintJob } from "../models/PrintJob";

//
// POST /printing
// usado pelo teu próprio backend pra criar o job
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
      payload,
      idempotencyKey,
    } = req.body;

    if (!restaurantId) {
      return res.status(400).json({ message: "restaurantId é obrigatório" });
    }
    if (!unitId) {
      return res.status(400).json({ message: "unitId é obrigatório" });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ message: "idempotencyKey é obrigatório" });
    }

    // idempotente: se já existir, devolve o existente (não cria duplicado)
    const existing = await PrintJob.findOne({ idempotencyKey }).lean();
    if (existing) return res.status(200).json(existing);

    const job = await PrintJob.create({
      restaurantId,
      unitId,
      station,
      orderId,
      tableId,
      action,
      items,
      payload: payload ?? null,
      idempotencyKey,
      status: "PENDING",
      attempts: 0,
      lastError: null,
    });

    return res.status(201).json(job);
  } catch (err: any) {
    // erro comum: duplicate key do idempotencyKey
    if (err?.code === 11000) {
      const key = req.body?.idempotencyKey;
      const existing = key ? await PrintJob.findOne({ idempotencyKey: key }).lean() : null;
      if (existing) return res.status(200).json(existing);
    }

    console.error("Erro ao criar print job:", err);
    return res.status(500).json({ message: "Erro ao criar print job" });
  }
};

//
// GET /printing/pending?unitId=U-MATRIZ&station=hot
// usado pelo printer-worker
//
export const getPendingPrintJobs = async (req: Request, res: Response) => {
  console.log("[printing] GET /printing/pending chamado", {
    headers: req.headers,
    query: req.query,
  });

  if (!req.worker) {
    console.warn("[printing] worker não autenticado");
    return res.status(401).end();
  }
  
  if (!req.worker) return res.status(401).end();
  const { restaurantId, unitId, stations } = req.worker;
  const { station, limit } = req.query;

  const q: any = { status: { $in: ["PENDING","SENT"] }, restaurantId, unitId };
  if (station) q.station = String(station);
  else if (Array.isArray(stations) && stations.length) q.station = { $in: stations };

  const jobs = await PrintJob.find(q).sort({ createdAt: 1 }).limit(Number(limit) || 20).lean();
  return res.json(jobs);
};

//
// PATCH /printing/:id/done
// chamado pelo worker depois que imprimiu
//
export const markPrintJobDone = async (req: Request, res: Response) => {
  if (!req.worker) return res.status(401).end();
  const { restaurantId, unitId } = req.worker;

  const job = await PrintJob.findOneAndUpdate(
    { _id: req.params.id, restaurantId, unitId },
    { $set: { status: "PRINTED", errorMessage: null } },
    { new: true }
  );
  if (!job) return res.status(404).json({ message: "Print job não encontrado no seu escopo" });
  return res.json(job);
};

//
// PATCH /printing/:id/fail
// opcional: se o worker capturar erro de impressora
//
export const markPrintJobFailed = async (req: Request, res: Response) => {
  try {
    if (!req.worker) return res.status(401).end();
    const { restaurantId, unitId } = req.worker;
    const { errorMessage } = req.body;

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

    if (!job) {
      return res.status(404).json({ message: "Print job não encontrado no seu escopo" });
    }

    return res.json(job);
  } catch (err: any) {
    console.error("Erro ao marcar como fail:", err);
    return res.status(500).json({ message: "Erro ao marcar como fail" });
  }
};

//
// PATCH /printing/claim?station=hot&limit=10
// Claim atomico para mais de uma impressora em mesma unidade,
// evitando double print.
//
export const claimPendingJobs = async (req: Request, res: Response) => {
  if (!req.worker) return res.status(401).end();
  const { restaurantId, unitId, stations } = req.worker;
  const { station } = req.query;

  const stationFilter = station
    ? { station: String(station) }
    : (Array.isArray(stations) && stations.length ? { station: { $in: stations } } : {});

  // pega em lote (exemplo 10) mudando status para "SENT"
  const jobs = await PrintJob.find({
    restaurantId, unitId, status: "PENDING", ...stationFilter,
  }).sort({ createdAt: 1 }).limit(10);

  const ids = jobs.map(j => j._id);
  if (ids.length) {
    await PrintJob.updateMany(
      { _id: { $in: ids }, status: "PENDING" },
      { $set: { status: "SENT", claimedAt: new Date() }, $inc: { attempts: 1 } }
    );
  }

  return res.json(jobs);
};
