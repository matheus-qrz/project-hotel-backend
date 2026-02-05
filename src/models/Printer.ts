// models/Printer.ts
import { Schema, Types, model } from "mongoose";

export interface IPrinter extends Document {
  _id: Types.ObjectId;
  unitId: string;                  // "U-MATRIZ"
  station: "hot"|"cold"|"bar";
  interface: "tcp"|"windows"|"cups"|"mock";
  address: "192.168.0.45";         // se tcp
  port: 9100;                      // se tcp
  queue: "Generic_Text_Only";      // se windows/cups
  codepage: 858;
  paperWidth: 80;                  // 58|80
  isEnabled: true;
  createdAt: Date;
  updatedAt: Date; 
}

const PrinterSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    unitId: { type: Schema.Types.ObjectId, ref: "RestaurantUnit", required: true },

    name: { type: String, required: true },              // "Cozinha Quente"
    station: { type: String, enum: ["hot", "cold", "bar"], required: true },

    interface: { type: String, enum: ["tcp", "windows", "cups"], required: true },
    address: { type: String }, // ip ou host
    port: { type: Number, default: 9100 },

    queue: { type: String },   // se windows/cups
    codepage: { type: Number, default: 858 },
    paperWidth: { type: Number, enum: [58, 80], default: 80 },

    enabled: { type: Boolean, default: true },

    lastHealth: {
      ok: { type: Boolean, default: null },
      checkedAt: { type: Date, default: null },
      message: { type: String, default: null },
    },
  },
  { timestamps: true }
);

export const PrinterModel = model("Printer", PrinterSchema);
