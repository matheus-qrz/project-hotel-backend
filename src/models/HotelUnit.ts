import mongoose from "mongoose";
import { HotelModel } from "./Hotel";
import { OperationalCosts } from "../utils/finantials";
import { DateTime } from "luxon";
const Schema = mongoose.Schema;

// models/HotelUnit.ts
export interface IHotelUnit extends Document {
  name: string;
  isMatrix: boolean;
  address: {
    zipCode: string;
    street: string;
    number: number;
    complement: string
  };
  cnpj: string;
  socialName: string;
  manager: string;
  phone: string;
  attendants: mongoose.Types.ObjectId[];
  orders: mongoose.Types.ObjectId[];
  hotel: mongoose.Types.ObjectId;
  isActive: boolean;
  operationalCosts: OperationalCosts;
  timezone?: string;
};

// Alias para compatibilidade
export interface IRestaurantUnit extends IHotelUnit {}

const hotelUnitSchema = new Schema({
  name: { type: String, required: true },
  socialName: { type: String, required: true },
  cnpj: { type: String, required: true },
  phone: { type: String, required: true },
  address: {
    street: { type: String, required: true },
    number: { type: String, required: true },
    complement: String,
    zipCode: { type: String, required: true }
  },
  businessHours: [{
    days: [{ type: String }],
    opens: String,
    closes: String
  }],
  managers: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  }],
  attendants: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  orders: [{
    type: Schema.Types.ObjectId,
    ref: 'Order'
  }],
  hotel: {
    type: Schema.Types.ObjectId,
    ref: 'Hotel',
    required: true
  },
  isMatrix: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['active', 'outOfHours', 'inactive'],
    default: 'active'
  },
  timezone: { type: String, default: "America/Sao_Paulo" }
}, {
  timestamps: true,
});

// Criar o modelo
export const HotelUnitModel = mongoose.model<IHotelUnit>(
  "HotelUnit",
  hotelUnitSchema
);

// Alias para compatibilidade durante transicao
export const RestaurantUnitModel = HotelUnitModel;

// METHODS

// Get All Hotel Units
export const getHotelUnits = () => HotelUnitModel.find();
export const getRestaurantUnits = getHotelUnits; // Alias

// Get Hotel Unit by Id
export const getHotelUnitById = (id: string) =>
  HotelUnitModel.findById(id);
export const getRestaurantUnitById = getHotelUnitById; // Alias

// Get Hotel Units by Hotel Id
export const getHotelUnitsByHotel = (hotelId: string) =>
  HotelUnitModel.find({ hotel: hotelId });
export const getRestaurantUnitsByRestaurant = getHotelUnitsByHotel; // Alias

// Novo metodo para buscar unidades incluindo a matriz
export const getHotelUnitsWithMatrix = async (hotelId: string) => {
  const hotel = await HotelModel.findById(hotelId);
  if (!hotel) return null;

  // Criar unidade matriz
  const matrixUnit = {
    _id: hotel._id,
    name: `${hotel.name} (Matriz)`,
    isMatrix: true,
    address: hotel.address,
    cnpj: hotel.cnpj,
    socialName: hotel.socialName,
    manager: hotel.managers || [],
    phone: hotel.phone,
    attendants: [],
    orders: [],
    hotel: hotel._id,
    isActive: true
  };

  // Buscar unidades regulares
  const regularUnits = await HotelUnitModel.find({
    hotel: hotelId,
    isMatrix: false
  });

  return [matrixUnit, ...regularUnits];
};
export const getRestaurantUnitsWithMatrix = getHotelUnitsWithMatrix; // Alias

// Create Hotel Unit
export const createHotelUnit = (values: Record<string, any>) =>
  new HotelUnitModel(values).save().then((unit) => unit.toObject());
export const createRestaurantUnit = createHotelUnit; // Alias

// Delete Hotel Unit
export const deleteHotelUnit = (id: string) =>
  HotelUnitModel.findOneAndDelete({ _id: id });
export const deleteRestaurantUnit = deleteHotelUnit; // Alias

// Update Hotel Unit
export const updateHotelUnit = (id: string, values: Record<string, any>) =>
  HotelUnitModel.findByIdAndUpdate(id, values, { new: true });
export const updateRestaurantUnit = updateHotelUnit; // Alias
