import mongoose from "mongoose";
const { Schema, Types } = mongoose;

export interface IRangeAssignment extends mongoose.Document {
  restaurantUnit: mongoose.Types.ObjectId; // unidade
  startTable: number;                       // início do intervalo (inclusive)
  endTable: number;                         // fim do intervalo (inclusive)
  attendant: mongoose.Types.ObjectId;       // usuário (ATTENDANT/MANAGER)
  label?: string | null;                    // opcional: "Ala Norte", "Salão 1"
  startsAt?: Date | null;                   // início da vigência (null = agora)
  endsAt?: Date | null;                     // fim da vigência (null = aberto)
  updatedAt?: Date | null;                  // última atualização
  isActive: boolean;                        // soft-disable administrativo
}

const rangeAssignmentSchema = new Schema<IRangeAssignment>({
  restaurantUnit: { type: Schema.Types.ObjectId, ref: "RestaurantUnit", required: true },
  startTable:     { type: Number, required: true },
  endTable:       { type: Number, required: true },
  attendant:      { type: Schema.Types.ObjectId, ref: "User", required: true },
  label:          { type: String, default: null },
  startsAt:       { type: Date, default: null },
  endsAt:         { type: Date, default: null },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

// Índices para consultas "quem atende agora?"
rangeAssignmentSchema.index({ restaurantUnit: 1, startTable: 1, endTable: 1, isActive: 1 });
rangeAssignmentSchema.index({ restaurantUnit: 1, startsAt: 1, endsAt: 1 });

export const RangeAssignmentModel = mongoose.model<IRangeAssignment>(
  "RangeAssignment",
  rangeAssignmentSchema
);
