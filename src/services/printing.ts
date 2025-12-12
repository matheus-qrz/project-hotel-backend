// services/printing.ts
import crypto from "crypto";
import { PrinterModel } from "../models/Printer";
import { PrintJobModel } from "../models/PrintJob";

const WORKER_URL = process.env.PRINT_WORKER_URL;

export type PrintAction = "NEW_TICKET" | "ADD_ITEMS" | "CANCEL_ITEMS" | "REPRINT";
export type Station = "hot" | "cold" | "bar";

type OrderInput = any;

/**
 * Tipos usados pelo payload rico enviado ao worker
 */
export interface PrintJobAddon {
  name: string;
  qty: number;
}

export interface PrintJobItem {
  name: string;
  qty: number;

  // novos campos
  observations?: string;       // observações por item
  addons?: PrintJobAddon[];    // addons do item
  isPromo?: boolean;           // item em promoção
  isCombo?: boolean;           // item de combo
}

export interface PrintJobPayload {
  restaurantId?: string | null;
  unitId: string;
  orderId: string;
  tableId: number | string | null;
  station: Station;
  action: PrintAction;
  createdAt: string;           // ISO datetime do job
  printedAt: string;           // data/hora formatada na timezone correta

  // cabeçalho extra
  waiterName?: string;         // garçom responsável
  customerName?: string;       // nome do cliente/guest
  unitName?: string;           // nome da unidade
  unitAddress?: string;        // endereço da unidade
  restaurantLogoUrl?: string;  // logo do restaurante (URL ou caminho)

  items: PrintJobItem[];
}

function extractId(value: any): string | null {
  if (!value) return null;

  // já é string
  if (typeof value === "string") return value;

  // number (só por garantia)
  if (typeof value === "number") return String(value);

  // ObjectId ou objeto populado
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);

  return null;
}

function makeIdempotencyKey(
  orderId: string,
  unitId: string,
  station: string,
  action: string,
  version = "v1"
) {
  const base = `${orderId}|${unitId}|${station}|${action}|${version}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

/**
 * Formata uma data na timezone desejada em pt-BR (ex: "18/11/2025 13:45").
 */
function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  // Node já suporta Intl com timeZone, sem precisar de libs extras
  const d = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  return `${d.day}/${d.month}/${d.year} ${d.hour}:${d.minute}`;
}

/**
 * Normaliza um Order vindo do Mongoose (Document) para o formato base que a
 * impressão precisa. Aqui já aproveitamos pra extrair:
 *
 *  - unitId / tableId / orderId
 *  - waiterName (garçom)
 *  - customerName (guest)
 *  - unitName / unitAddress
 *  - restaurantLogoUrl
 *  - printedAt (data/hora formatada na timezone da unidade/restaurante)
 *  - items (array bruto, como vem do Order, para depois quebrar por estação)
 */
function normalizeOrderForPrint(order: OrderInput) {
const o = typeof order?.toObject === "function" ? order.toObject() : order;

  // 🔧 Corrige unitId (aceita vários formatos)
  const unitId =
    extractId(o.unitId) ??
    extractId(o.restaurantUnit) ??
    extractId(o.restaurantUnitId) ??
    null;

  // 🔧 Corrige restaurantId (id do restaurante "pai")
  const restaurantId =
    extractId(o.restaurantId) ??
    extractId(o.restaurant) ??
    null;

  // mesa: tenta meta.tableId primeiro (seu padrão atual)
  const tableId = o.meta?.tableId ?? o.tableId ?? null;

  const orderId = o.orderCode ?? o._id;
  const items = Array.isArray(o.items) ? o.items : [];

  // timezone: tenta pegar da unidade, depois do restaurante, senão fallback
  const timezone =
    o.restaurantUnit?.timezone ||
    o.restaurant?.timezone ||
    process.env.DEFAULT_TZ ||
    "America/Fortaleza";

  const createdAtDate = o.createdAt ? new Date(o.createdAt) : new Date();
  const printedAt = formatDateTimeInTimeZone(createdAtDate, timezone);

  // nome do garçom, como você já tinha
  const waiterName =
    o.attendant?.name ??
    o.attendantName ??
    o.waiterName ??
    undefined;

  // nome do cliente / guest
  const customerName =
    o.guest?.name ??
    o.guestInfo?.name ??
    o.guestName ??
    o.customerName ??
    undefined;

  // nome e endereço da unidade
  const unitName =
    o.restaurantUnit?.name ??
    o.unitName ??
    undefined;

  const unitAddress =
    o.restaurantUnit?.address ??
    o.restaurantUnit?.fullAddress ??
    o.unitAddress ??
    undefined;

  // logo do restaurante
  const restaurantLogoUrl =
    o.restaurant?.logo ??
    o.restaurant?.logoUrl ??
    o.logo ??
    undefined;

  return {
    restaurantId,
    unitId: unitId ?? "",
    tableId,
    orderId: String(orderId),
    items,
    waiterName,
    customerName,
    unitName,
    unitAddress,
    restaurantLogoUrl,
    printedAt,
    createdAtISO: createdAtDate.toISOString(),
  };
}

/**
 * Cria 1 job por estação do pedido, de forma idempotente.
 * Pode ser usado direto no controller:
 *   await enqueuePrintJobsFromOrder(doc, "NEW_TICKET")
 */
export async function enqueuePrintJobsFromOrder(
  order: OrderInput,
  action: PrintAction,
  printSeq: number | string = "v1"
) {
  const norm = normalizeOrderForPrint(order);

  // se nem unitId/restaurantUnit veio, aí sim não faz sentido imprimir
  if (!norm.unitId) {
    console.warn("[printing] order sem unitId/restaurantUnit; ignorando impressão", {
      orderId: norm.orderId,
      rawUnitId: (order as any)?.unitId,
      rawRestaurantUnit: (order as any)?.restaurantUnit,
    });
    return;
  }

  // restaurantId é opcional: se faltar, avisa mas segue
  if (!norm.restaurantId) {
    console.warn("[printing] order sem restaurantId; seguindo sem cabeçalho de restaurante", {
      orderId: norm.orderId,
    });
  }

  // Descobre as estações a partir dos itens (kitchenStation)
  const stations = new Set<Station>();
  for (const it of norm.items) {
    if (it?.kitchenStation) stations.add(it.kitchenStation as Station);
  }

  for (const station of stations) {
    // Itens da estação corrente
    const itemsForStation: PrintJobItem[] = norm.items
      .filter((it: any) => it.kitchenStation === station)
      .map((it: any) => {
        const addons: PrintJobAddon[] | undefined = Array.isArray(it.addons)
          ? it.addons.map((ad: any) => ({
              name: ad.name || ad.label || ad.title,
              qty: ad.quantity ?? ad.qty ?? 1,
            }))
          : undefined;

        const isPromo =
          !!it.appliedPromotionId ||
          !!it.promotionId ||
          !!it.isPromotional ||
          false;

        const isCombo =
          !!it.comboId ||
          !!it.isCombo ||
          false;

        return {
          name: it.name,
          qty: it.quantity ?? it.qty ?? 1,
          observations: it.observations ?? it.notes ?? "",
          addons,
          isPromo,
          isCombo,
        };
      });

    if (!itemsForStation.length) continue;

    const idempotencyKey = makeIdempotencyKey(
      String(norm.orderId),
      String(norm.unitId),
      String(station),
      String(action),
      String(printSeq)
    );

    const payload: PrintJobPayload = {
      restaurantId: norm.restaurantId,
      unitId: norm.unitId,
      orderId: norm.orderId,
      tableId: norm.tableId,
      station,
      action,
      createdAt: norm.createdAtISO,
      printedAt: norm.printedAt,
      waiterName: norm.waiterName,
      customerName: norm.customerName,
      unitName: norm.unitName,
      unitAddress: norm.unitAddress,
      restaurantLogoUrl: norm.restaurantLogoUrl,
      items: itemsForStation,
    };

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
          // mantém items "simples" para compat, se o worker antigo ainda usar
          items: itemsForStation,
          payload, // 👈 aqui vai o payload rico
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
 * Envia os jobs PENDING para o worker (modo "push").
 * Se existir payload rico no job, usa ele; caso contrário, cai no formato antigo.
 */
export async function dispatchPendingPrintJobs(limit = 30) {
  if (!WORKER_URL) return;

  const jobs = await PrintJobModel.find({ status: "PENDING" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  for (const job of jobs as any[]) {
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
      // Se tiver payload, envia ele; senão, envia o formato antigo
      const body: any = job.payload
        ? job.payload
        : {
            unitId: String(job.unitId),
            restaurantId: job.restaurantId ? String(job.restaurantId) : undefined,
            orderId: String(job.orderId),
            tableId: job.tableId,
            station: job.station,
            action: job.action,
            createdAt: job.createdAt,
            items: job.items,
          };

      const r = await fetch(`${WORKER_URL}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
