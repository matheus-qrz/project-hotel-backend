// src/models/RangeAssignment.ts
import mongoose, { Schema } from "mongoose";

export interface IRangeAssignment extends mongoose.Document {
  restaurant?: mongoose.Types.ObjectId | null;
  restaurantUnit?: mongoose.Types.ObjectId | null; // usamos este campo como "unitId"
  startTable: number;
  endTable: number;
  attendant: mongoose.Types.ObjectId | null;       // equivalente a attendantId
  attendantName: string | null;
  label?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  daysOfWeek: number[];                             // 0..6 (NOVO)
  updatedAt?: Date | null;
  isActive: boolean;
}

const RangeAssignmentSchema = new Schema<IRangeAssignment>(
  {
    restaurant:     { type: Schema.Types.ObjectId, ref: "Restaurant", index: true, default: null },
    restaurantUnit: { type: Schema.Types.ObjectId, ref: "RestaurantUnit", index: true, default: null },

    startTable:     { type: Number, required: true, min: 1 },
    endTable:       { type: Number, required: true, min: 1 },

    attendant:      { type: Schema.Types.ObjectId, ref: "User", default: null },
    attendantName:  { type: String, default: null }, // não precisa de ref

    label:          { type: String, default: null },

    // guardamos como Date (âncora 1970-01-01 + HH:mm)
    startsAt:       { type: Date, default: null },
    endsAt:         { type: Date, default: null },

    // NOVO: um único documento reúne os dias
    daysOfWeek:     {
      type: [Number],
      default: [],
      validate: {
        validator: (arr: number[]) =>
          Array.isArray(arr) &&
          arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: "daysOfWeek deve conter inteiros 0..6",
      },
    },

    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Índices auxiliares que você já tinha (mantidos)
RangeAssignmentSchema.index({ restaurantUnit: 1, startTable: 1, endTable: 1, isActive: 1 });
RangeAssignmentSchema.index({ restaurantUnit: 1, startsAt: 1, endsAt: 1 });
RangeAssignmentSchema.index({ attendant: 1, startsAt: 1, endsAt: 1 });

// **Recomendado**: índice ÚNICO para evitar duplicatas por combinação
// (um doc por restaurantUnit + faixa + atendente + rótulo + horário)
RangeAssignmentSchema.index(
  { restaurantUnit: 1, startTable: 1, endTable: 1, attendant: 1, label: 1, startsAt: 1, endsAt: 1 },
  { unique: true, name: "uniq_ru_range_attendant_time" }
);

export const RangeAssignmentModel = mongoose.model<IRangeAssignment>(
  "RangeAssignment",
  RangeAssignmentSchema
);
