// services/printing.ts
import crypto from "crypto";
import { PrinterModel } from "../models/Printer";
import { PrintJobModel } from "../models/PrintJob";

const WORKER_URL = process.env.PRINT_WORKER_URL;

type Station = "hot" | "cold" | "bar";
type PrintAction = "NEW_TICKET" | "ADD_ITEMS" | "CANCEL_ITEMS";

type OrderInput = any;

function makeIdempotencyKey(orderId: string, unitId: string, station: string, action: string, version = "v1") {
  const base = `${orderId}|${unitId}|${station}|${action}|${version}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

/**
 * Normaliza um Order vindo do Mongoose (Document) para o formato que a impressão precisa.
 * Aceita:
 *  - doc Mongoose
 *  - objeto plain
 *  - campos com nomes diferentes (restaurantUnit, meta.tableId, etc)
 */
function normalizeOrderForPrint(order: OrderInput) {
  // se for Document, transforma
  const o = typeof order?.toObject === "function" ? order.toObject() : order;

  // tu usa restaurantUnit no schema
  const unitId = o.unitId ?? o.restaurantUnit;
  // restaurante pode não existir no Order -> deixa opcional
  const restaurantId = o.restaurantId ?? o.restaurant ?? null;
  // tua mesa está em meta.tableId
  const tableId = o.tableId ?? o.meta?.tableId ?? null;
  const orderId = o._id;

  const items = Array.isArray(o.items) ? o.items : [];

  return {
    restaurantId,
    unitId,
    tableId,
    orderId,
    items,
  };
}

/**
 * Cria 1 job por estação do pedido, de forma idempotente.
 * Pode ser usado direto no controller: await enqueuePrintJobsFromOrder(doc, "NEW_TICKET")
 */
export async function enqueuePrintJobsFromOrder(
  order: OrderInput,
  action: PrintAction,
  printSeq: number | string = "v1" 
) {
  const norm = normalizeOrderForPrint(order);

  if (!norm.unitId || !norm.restaurantId) {
    console.warn("[printing] order sem unitId/restaurantId; ignorando impressão");
    return;
  }

  const stations = new Set<Station>();
  for (const it of norm.items) {
    if (it?.kitchenStation) stations.add(it.kitchenStation as Station);
  }

  for (const station of stations) {
    const itemsForStation = norm.items
      .filter((it: any) => it.kitchenStation === station)
      .map((it: any) => ({
        name: it.name,
        qty: it.quantity ?? it.qty ?? 1,
        notes: it.notes ?? "",
      }));

    if (!itemsForStation.length) continue;

    const idempotencyKey = makeIdempotencyKey(
      String(norm.orderId),
      String(norm.unitId),
      String(station),
      String(action),
      String(printSeq) 
    );

    await PrintJobModel.updateOne(
      { idempotencyKey },
      {
        $setOnInsert: {
          restaurantId: norm.restaurantId,
          unitId: norm.unitId,
          orderId: norm.orderId,
          tableId: norm.tableId,
          station,
          action,
          items: itemsForStation,
          idempotencyKey,
          status: "PENDING",
          attempts: 0,
        },
      },
      { upsert: true }
    );
  }
}

/**
 * Envia os jobs PENDING para o worker.
 */
export async function dispatchPendingPrintJobs(limit = 30) {
  if (!WORKER_URL) return;

  const jobs = await PrintJobModel.find({ status: "PENDING" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  for (const job of jobs) {
    // confere se temos impressora ativa pra essa unit/station
    const printer = await PrinterModel.findOne({
      unitId: job.unitId,
      station: job.station,
      enabled: true,
    }).lean();

    if (!printer) {
      await PrintJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "SKIPPED_NO_PRINTER",
            lastError: "No enabled printer for this unit/station",
          },
        }
      );
      continue;
    }

    try {
      const r = await fetch(`${WORKER_URL}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: String(job.unitId),
          restaurantId: job.restaurantId ? String(job.restaurantId) : undefined,
          orderId: String(job.orderId),
          tableId: job.tableId,
          station: job.station,
          action: job.action,
          createdAt: job.createdAt,
          items: job.items,
        }),
      });

      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `worker responded ${r.status}`);
      }

      await PrintJobModel.updateOne(
        { _id: job._id },
        { $set: { status: "SENT", sentAt: new Date(), lastError: null } }
      );
    } catch (err: any) {
      await PrintJobModel.updateOne(
        { _id: job._id },
        {
          $inc: { attempts: 1 },
          $set: { status: "FAILED", lastError: err?.message ?? String(err) },
        }
      );
    }
  }
}
