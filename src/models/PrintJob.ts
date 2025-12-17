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

export interface IPrintJob extends Document {
  _id: Types.ObjectId;
  restaurantId: string;
  unitId: string;
  orderId?: string;
  tableId: string | number | null;

  station?: PrintStation;
  action: PrintAction;

  // compat + worker
  items: IPrintJobItem[];

  // payload rico pro worker
  payload?: any;

  idempotencyKey: string;
  status: PrintStatus;

  attempts: number;
  lastError?: string | null;

  sentAt?: Date | null;
  claimedAt?: Date | null;
}

const PrintJobSchema = new Schema(
  {
    restaurantId: { type: String, required: true, index: true },
    unitId: { type: String, required: true, index: true },

    orderId: { type: String, index: true },
    tableId: { type: Schema.Types.Mixed },

    station: { type: String, index: true },
    action: {
      type: String,
      required: true,
      enum: ["NEW_TICKET", "ADD_ITEMS", "CANCEL_ITEMS", "REPRINT"],
    },

    // compat simples
    items: {
      type: [
        {
          name: String,
          qty: Number,
          notes: String,
          observations: String,
          addons: [{ name: String, qty: Number }],
          isPromo: Boolean,
          isCombo: Boolean,
        },
      ],
      default: [],
    },

    // ✅ payload rico (worker usa)
    payload: { type: Schema.Types.Mixed, default: null },

    idempotencyKey: { type: String, required: true, unique: true, index: true },

    // ✅ alinhado com service/controller
    status: {
      type: String,
      enum: ["PENDING", "SENT", "PRINTED", "FAILED", "SKIPPED_NO_PRINTER"],
      default: "PENDING",
      index: true,
    },

    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },

    sentAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const PrintJobModel = model("PrintJob", PrintJobSchema);
