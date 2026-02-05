// models/PrinterWorkerToken.ts
import { Schema, model } from "mongoose";

const PrinterWorkerTokenSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    
    restaurantId: { type: String, required: true },
    unitId: { type: String, required: true },

    name: { type: String }, // ex: "PC Caixa", "Cozinha"
    stations: {
      type: [String],
      default: [],
    }, // ex: ["hot", "bar"] (opcional)

    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date },
  },
  { timestamps: true }
);

export const PrinterWorkerToken =
  model("PrinterWorkerToken", PrinterWorkerTokenSchema);
