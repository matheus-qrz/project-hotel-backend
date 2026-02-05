import mongoose from "mongoose";
import { RestaurantModel } from "./Restaurant";
import { OperationalCosts } from "../utils/finantials";
import { DateTime } from "luxon";
const Schema = mongoose.Schema;

// models/RestaurantUnit.ts
export interface IRestaurantUnit extends Document {
  name: string;
  isMatrix: boolean; // Novo campo
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
  restaurant: mongoose.Types.ObjectId;
  isActive: boolean;
  operationalCosts: OperationalCosts;
  timezone?: string;
};

const restaurantUnitSchema = new Schema({
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
  restaurant: {
    type: Schema.Types.ObjectId,
    ref: 'Restaurant',
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
export const RestaurantUnitModel = mongoose.model<IRestaurantUnit>(
  "RestaurantUnit",
  restaurantUnitSchema
);

// METHODS

// Get All Restaurant Units
export const getRestaurantUnits = () => RestaurantUnitModel.find();

// Get Restaurant Unit by Id
export const getRestaurantUnitById = (id: string) =>
  RestaurantUnitModel.findById(id);

// Get Restaurant Units by Restaurant Id
export const getRestaurantUnitsByRestaurant = (restaurantId: string) =>
  RestaurantUnitModel.find({ restaurant: restaurantId });

// Novo método para buscar unidades incluindo a matriz
export const getRestaurantUnitsWithMatrix = async (restaurantId: string) => {
  const restaurant = await RestaurantModel.findById(restaurantId);
  if (!restaurant) return null;

  // Criar unidade matriz
  const matrixUnit = {
    _id: restaurant._id,
    name: `${restaurant.name} (Matriz)`,
    isMatrix: true,
    address: restaurant.address,
    cnpj: restaurant.cnpj,
    socialName: restaurant.socialName,
    manager: restaurant.managers || [],
    phone: restaurant.phone,
    attendants: [],
    orders: [],
    restaurant: restaurant._id,
    isActive: true
  };

  // Buscar unidades regulares
  const regularUnits = await RestaurantUnitModel.find({
    restaurant: restaurantId,
    isMatrix: false
  });

  return [matrixUnit, ...regularUnits];
};

// Create Restaurant Unit
export const createRestaurantUnit = (values: Record<string, any>) =>
  new RestaurantUnitModel(values).save().then((unit) => unit.toObject());

// Delete Restaurant Unit
export const deleteRestaurantUnit = (id: string) =>
  RestaurantUnitModel.findOneAndDelete({ _id: id });

// Update Restaurant Unit
export const updateRestaurantUnit = (id: string, values: Record<string, any>) =>
  RestaurantUnitModel.findByIdAndUpdate(id, values, { new: true });