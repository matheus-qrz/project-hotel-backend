// models/PrintJob.ts
import { Schema, Types, model } from "mongoose";

export type PrintStation = "hot" | "cold" | "bar";
export type PrintAction = "NEW_TICKET" | "ADD_ITEMS" | "CANCEL_ITEMS" | "REPRINT";
export type PrintStatus =
  | "PENDING"
  | "SENT"
  | "PRINTED"
  | "FAILED"
  | "SKIPPED_NO_PRINTER";

export interface PrintJobAddon {
  name: string;
  qty: number;
}

export interface IPrintJobItem {
  name: string;
  qty: number;
  notes?: string;
  observations?: string;
  addons?: PrintJobAddon[];
  isPromo?: boolean;
  isCombo?: boolean;
}

export interface IPrintJob /* extends Document (opcional, se você estiver tipando) */ {
  _id: Types.ObjectId;

  restaurantId: Types.ObjectId | string;
  unitId: Types.ObjectId | string;

  orderId?: Types.ObjectId | string;
  tableId?: string | number | null;

  attendantId?: string;
  attendantName?: string;
  guestId?: string;
  guestName?: string;

  station: PrintStation;
  action: PrintAction;

  // compat simples
  items: IPrintJobItem[];

  // ✅ payload rico (worker novo)
  payload?: any;

  idempotencyKey: string;
  status: PrintStatus;

  attempts: number;

  // ✅ padroniza (o resto do teu código usa lastError)
  lastError?: string | null;

  sentAt?: Date | null;
  claimedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const PrintJobItemSchema = new Schema(
  {
    name: { type: String, required: true },
    qty: { type: Number, required: true },

    notes: { type: String },
    observations: { type: String },

    addons: {
      type: [
        {
          name: { type: String, required: true },
          qty: { type: Number, required: true },
        },
      ],
      default: [],
    },

    isPromo: { type: Boolean, default: false },
    isCombo: { type: Boolean, default: false },
  },
  { _id: false }
);

const PrintJobSchema = new Schema(
  {
    restaurantId: { type: String, required: true, index: true },
    unitId: { type: String, required: true, index: true },

    orderId: { type: String, index: true },
    tableId: { type: Schema.Types.Mixed },

    attendantId: { type: String },
    attendantName: { type: String },
    guestId: { type: String },
    guestName: { type: String },

    station: { type: String, enum: ["hot", "cold", "bar"], index: true },
    action: {
      type: String,
      enum: ["NEW_TICKET", "ADD_ITEMS", "CANCEL_ITEMS", "REPRINT"],
      required: true,
      index: true,
    },

    // compat com worker antigo
    items: { type: [PrintJobItemSchema], default: [] },

    // ✅ payload rico (worker novo)
    payload: { type: Schema.Types.Mixed, default: null },

    idempotencyKey: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: ["PENDING", "SENT", "PRINTED", "FAILED", "SKIPPED_NO_PRINTER"],
      default: "PENDING",
      index: true,
    },

    attempts: { type: Number, default: 0 },

    // ✅ padronizado
    lastError: { type: String, default: null },

    sentAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const PrintJobModel = model("PrintJob", PrintJobSchema);
