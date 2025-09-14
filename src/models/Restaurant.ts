import mongoose from "mongoose";
import { OperationalCosts } from "../utils/finantials";
const Schema = mongoose.Schema;

export interface IRestaurant extends Document {
  name: string;
  logo: string;
  cnpj: string;
  socialName: string;
  address: {
    zipCode: string;
    street: string;
    number: number;
    complement: string
  };
  rating: number;
  specialty: string;
  phone: string;
  admin: {
    email: string;
    fullName: string;
    cpf: string;
  };
  managers: mongoose.Types.ObjectId[];
  attendants: mongoose.Types.ObjectId[];
  units: mongoose.Types.ObjectId[];
  authentication: {
    password: string;
    salt: string;
    sessionToken: string;
  },
  businessHours?: Array<{
    days: string[];
    open: string;
    close: string;
  }>;
  operationalCosts: OperationalCosts;
}

const restaurantSchema = new Schema({
  name: { type: String, required: true, unique: true },
  socialName: { type: String },
  cnpj: { type: String, required: true, unique: true },
  logo: { type: String },
  address: {
    zipCode: String,
    street: String,
    number: Number,
    complement: String
  },
  specialty: String,
  phone: String,

  // Informações do admin/proprietário do restaurante
  admin: {
    fullName: { type: String, required: true },
    cpf: { type: String, required: true },
    email: { type: String, required: true, unique: true }, // Email para login
  },

  // Credenciais de autenticação para o restaurante/admin
  authentication: {
    password: { type: String, required: true, select: false }, // Hash da senha
    salt: { type: String, required: true, select: false }, // Salt para a senha
    sessionToken: { type: String, select: false } // Token de sessão
  },
  managers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  attendants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  units: [{ type: Schema.Types.ObjectId, ref: 'RestaurantUnit' }],
  businessHours: [{
    days: [String],
    open: String,
    close: String
  }],
  operationalCosts: {
    fixed: {
      rent: { type: Number, default: 0 },
      utilities: { type: Number, default: 0 },
      salaries: { type: Number, default: 0 },
      marketing: { type: Number, default: 0 },
      other: { type: Number, default: 0 }
    },
    variable: {
      costPercentage: { type: Number, default: 40 }, // 40% como padrão            
      averageIngredientCost: { type: Number, default: 0 },
      averagePackagingCost: { type: Number, default: 0 }
    }
  }
}, { 
  timestamps: true,
  timezone: { type: String, default: "America/Sao_Paulo" }
 });

export const RestaurantModel = mongoose.model<IRestaurant>("Restaurant", restaurantSchema);

// METHODS

// Get All Restaurants
export const getRestaurants = () => RestaurantModel.find();

// Get Restaurant by Id
export const getRestaurantById = (id: string) => RestaurantModel.findById(id);

// Get Restaurant by Name (also for register validation)
export const getRestaurantByName = (name: string) =>
  RestaurantModel.findOne({ name });

// Create Restaurant
export const createRestaurant = (values: Record<string, any>) =>
  new RestaurantModel(values).save().then((restaurant) => restaurant.toObject());

// Delete Restaurant
export const deleteRestaurant = (id: string) =>
  RestaurantModel.findOneAndDelete({ _id: id });

// Update Restaurant
export const updateRestaurant = (id: string, values: Record<string, any>) =>
  RestaurantModel.findByIdAndUpdate(id, values, { new: true });

export const getRestaurantBySlug = async (slug: string) => {
  const id = slug.split('-').pop();
  if (!id) return null;
  return RestaurantModel.findById(id);
};

// Buscar restaurante pelo email do admin (para login)
export const getRestaurantByEmail = (email: string) => {
  return RestaurantModel.findOne({ 'admin.email': email })
    .select('+authentication.password +authentication.salt +authentication.sessionToken');
};

// Buscar restaurante pelo token de sessão
export const getRestaurantBySessionToken = (sessionToken: string) => {
  return RestaurantModel.findOne({
    'authentication.sessionToken': sessionToken,
  }).select('+authentication.sessionToken');
};