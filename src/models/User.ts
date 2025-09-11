import mongoose from "mongoose";
import validator from "validator";

const Schema = mongoose.Schema;

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cpf?: string;
  avatar?: string;
  authentication: {
    password: string;
    salt: string;
    sessionToken: string;
  };
  role: "ADMIN" | "MANAGER" | "ATTENDANT" | "CLIENT";
  orders: mongoose.Schema.Types.ObjectId[];
  restaurant?: mongoose.Schema.Types.ObjectId;
  restaurantUnit?: mongoose.Schema.Types.ObjectId;
}

const userSchema = new Schema(
  {
    id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
      unique: true
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    cpf: {
      type: String,
      unique: true,
      sparse: true,
      set: (v: string) => (v ? v.replace(/\D/g, "") : v),
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
      required: function (this: any) {
        return this.role === "ADMIN" || this.role === "MANAGER";
      },
      minLength: 10,
      maxLength: 13,
    },
    avatar: {
      type: String,
      default: null
    },
    authentication: {
      password: {
        type: String,
        required: true,
        select: false
      },
      salt: { type: String, required: true, select: false },
      sessionToken: { type: String, default: "", select: false },
    },
    role: {
      type: String,
      enum: ["ADMIN", "MANAGER", "ATTENDANT", "CLIENT"],
      required: true,
      trim: true,
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order"
      }
    ],
    // Campos para referências
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant"
    },
    restaurantUnit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RestaurantUnit"
    }
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", userSchema);

// METHODS

// Get All Users
export const getUsers = () => UserModel.find();

// Get User by Id
export const getUserById = (id: string) => UserModel.findById(id);

// Get User by Email for Register Validation
export const getUserByEmail = (email: string) => {
  return UserModel.findOne({ email });
};

// Get User by SessionToken for Middleware
export const getUserBySessionToken = (sessionToken: string) => {
  return UserModel.findOne({
    'authentication.sessionToken': sessionToken,
  });
};

// Get User by Restaurant Unit
export const getUserByUnit = (unit: string) => {
  return UserModel
    .find({ restaurantUnit: unit })
    .select("+authentication.sessionToken +role");
};

// Get Users by Restaurant
export const getUsersByRestaurant = (restaurantId: string) => {
  return UserModel.find({ restaurant: restaurantId });
};

// Create User
export const createUser = (values: Record<string, any>, options = {}) =>
  new UserModel(values).save(options).then((user) => user.toObject());

// Delete User
export const deleteUser = (id: string) =>
  UserModel.findByIdAndDelete({ _id: id });

// Update User
export const updateUser = (id: string, values: Record<string, any>) =>
  UserModel.findByIdAndUpdate(id, values);