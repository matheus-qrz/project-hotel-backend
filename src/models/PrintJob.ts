// models/PrintJob.ts
import { Schema, Types, model } from "mongoose";

export type PrintStation = "hot" | "cold" | "bar";
export type PrintAction = "NEW_TICKET" | "ADD_ITEMS" | "CANCEL_ITEMS";
export type PrintStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED_NO_PRINTER";

export interface PrintJobAddon {
  name: string;
  qty: number;
}

export interface IPrintJobItem {
  name: string;
  qty: number;
  notes?: string;
  observations?: string;        // observações por item
  addons?: PrintJobAddon[];     // addons do item
  isPromo?: boolean;            // item em promoção
  isCombo?: boolean;            // item de combo
}

export interface IPrintJob extends Document {
  _id: Types.ObjectId;
  restaurantId?: Types.ObjectId | string | null;
  unitId: Types.ObjectId | string;
  orderId: Types.ObjectId | string;
  tableId: string | number | null;
  attendantId?: string;
  attendantName?: string;
  guestId?: string;
  guestName?: string;
  station: PrintStation;
  action: PrintAction;
  items: IPrintJobItem[];
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
  status: PrintStatus;
  attempts: number;
  lastError?: string | null;
  sentAt?: Date | null;
}

const PrintJobSchema = new Schema(
  {
  restaurantId: { type: String, required: true, index: true },
  unitId:       { type: String, required: true, index: true },
  orderId:      { type: String, index: true },
  tableId:      { type: Schema.Types.Mixed },
  attendantId: { type: String },
  attendantName: { type: String },
  guestId: { type: String },
  guestName: { type: String },
  station:      { type: String, index: true },
  action:       { type: String, required: true }, // NEW_TICKET | REPRINT | CANCEL | ...
  items:        { type: [ { name: String, qty: Number, notes: String } ], default: [] },
  idempotencyKey: { type: String, required: true, unique: true }, // ⬅️
  status:       { type: String, enum: ["PENDING","PRINTED","FAILED"], default: "PENDING", index: true },
  attempts:     { type: Number, default: 0 },
  errorMessage: { type: String },
  },
  { timestamps: true }
);

export const PrintJobModel = model("PrintJob", PrintJobSchema);