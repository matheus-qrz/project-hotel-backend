// models/Products.ts
import mongoose, { Document, Schema } from "mongoose";
import { IRestaurant } from "./index";

// Adicione este tipo ao modelo de produto
export interface ComboOption {
  name: string; // Nome da opção (ex: tipo de hambúrguer)
  products: mongoose.Types.ObjectId[]; // Produtos que fazem parte desta opção
}

export interface IAdditional {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface IAccompaniment {
  id: string;
  name: string;
  isAvailable: boolean;
}

export interface IProduct extends Document {
  restaurant: mongoose.Schema.Types.ObjectId | IRestaurant;
  category: string;
  image: string;            // URL pública (mantém compatibilidade)
  imageBlur?: string;       // <<< LQIP (base64) para placeholder
  imageWidth?: number;      // opcional (pode ajudar no frontend)
  imageHeight?: number;     // opcional
  name: string;
  quantity: number;
  price: number;
  costPrice: number;
  description: string;
  isAvailable: boolean;
  isOnPromotion: boolean;
  promotionalPrice?: number;
  discountPercentage?: number;
  promotionStartDate?: Date;
  promotionEndDate?: Date;
  isCombo?: boolean; // Indica se é um combo
  comboOptions?: ComboOption[]; // Opções de combo
  isAdditional?: boolean; // Indica se é um adicional
  hasAddons?: boolean; // Indica se o produto tem adicionais
  additionalOptions?: IAdditional[]; // Lista de adicionais
  accompaniments?: IAccompaniment; // Acompanhamentos
  promotionalMetrics?: {
    viewCount: number;
    conversionCount: number;
    marketingCost: number;
    acquisitionCost: number;
    costPrice: number; // Custo do produto   
  }
};

const productSchema = new Schema<IProduct>({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Restaurant",
    required: true,
  },
  category: {
    type: String,
  },
  image: { type: String },
  imageBlur: { type: String },        
  imageWidth: { type: Number },       
  imageHeight: { type: Number },  
  name: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  costPrice: {
    type: Number,
    required: false
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
  description: {
    type: String,
  },
  isOnPromotion: {
    type: Boolean,
    default: false
  },
  isCombo: {
    type: Boolean,
    default: false
  },
  comboOptions: [
    {
      name: { type: String, required: true },
      products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }]
    }
  ],
  isAdditional: {
    type: Boolean,
    default: false
  },
  hasAddons: {
    type: Boolean,
    default: false
  },
  additionalOptions: [
    {
      id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      isAvailable: { type: Boolean, default: true }
    }
  ],
  accompaniments: [
    {
      id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      name: { type: String, required: true },
      isAvailable: { type: Boolean, default: true }
    }
  ],
  promotionalPrice: {
    type: Number
  },
  discountPercentage: {
    type: Number
  },
  promotionStartDate: {
    type: Date
  },
  promotionEndDate: {
    type: Date
  },
  promotionalMetrics: {
    viewCount: { type: Number, default: 0 },
    conversionCount: { type: Number, default: 0 },
    marketingCost: { type: Number, default: 0 },
    acquisitionCost: { type: Number, default: 0 },
    costPrice: { type: Number, default: 0 }
  }
});

// Middleware para calcular preço promocional automaticamente quando o percentual de desconto for definido
productSchema.pre('save', function (next) {
  if (this.isOnPromotion && this.discountPercentage && this.price) {
    this.promotionalPrice = this.price - (this.price * (this.discountPercentage / 100));
  }
  next();
});

// Middleware para verificar se a promoção expirou (pode ser chamado por um job agendado)
productSchema.methods.checkPromotionValidity = function () {
  const now = new Date();
  if (this.isOnPromotion && this.promotionEndDate && now > this.promotionEndDate) {
    this.isOnPromotion = false;
    this.promotionalPrice = undefined;
    this.discountPercentage = undefined;
    this.promotionStartDate = undefined;
    this.promotionEndDate = undefined;
    return this.save();
  }
  return Promise.resolve(this);
};

export const ProductModel = mongoose.model<IProduct>("Product", productSchema);

// Métodos

// Obter todos os produtos
export const getProducts = () => ProductModel.find();

// Obter produtos de um restaurante específico
export const getProductsByRestaurant = (restaurantId: string) =>
  ProductModel.find({ restaurant: restaurantId })
    .select('_id name price category image imageBlur imageWidth imageHeight isOnPromotion promotionalPrice promotionEndDate isCombo additionalOptions accompaniments description discountPercentage isAvailable');

// Obter produtos em promoção de um restaurante específico
export const getPromotionalProducts = (restaurantId: string) =>
  ProductModel.find({
    restaurant: restaurantId,
    isOnPromotion: true,
    promotionEndDate: { $gt: new Date() }
  });

// Obter produto por ID
export const getProductById = (id: string) => ProductModel.findById(id);

// Obter produto por nome (para validação de registro)
export const getProductByName = (name: string) => ProductModel.findOne({ name });

// Criar produto
export const createProduct = (values: Record<string, any>) =>
  new ProductModel(values).save().then((product) => product.toObject());

// Deletar produto
export const deleteProduct = (id: string) =>
  ProductModel.findOneAndDelete({ _id: id });

// Atualizar produto
export const updateProduct = async (id: string, values: Record<string, any>) => {
  const doc = await ProductModel.findById(id);
  if (!doc) return null;

  Object.assign(doc, values);

  // garantir cálculo de promoção mesmo em update:
  if (doc.isOnPromotion) {
    if (doc.discountPercentage && !doc.promotionalPrice) {
      doc.promotionalPrice = doc.price - (doc.price * (doc.discountPercentage / 100));
    }
    if (doc.promotionalPrice && !doc.discountPercentage) {
      doc.discountPercentage = Math.round(((doc.price - doc.promotionalPrice) / doc.price) * 100);
    }
  } else {
    doc.promotionalPrice = undefined;
    doc.discountPercentage = undefined;
    doc.promotionStartDate = undefined;
    doc.promotionEndDate = undefined;
  }

  return doc.save();
};