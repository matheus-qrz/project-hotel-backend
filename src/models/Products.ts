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
  image: string;            
  imageBlur?: string;       
  imageWidth?: number;      
  imageHeight?: number;     
  name: string;
  quantity: number;
  price: number;
  costPrice: number;
  description: string;
  isAvailable: boolean;
  isCombo?: boolean; 
  comboOptions?: ComboOption[]; 
  isAdditional?: boolean; 
  hasAddons?: boolean; 
  additionalOptions?: IAdditional[];
  accompaniments?: IAccompaniment;
  isOnPromotion: boolean;
  promotionalPrice?: number;
  discountPercentage?: number | null;
  promotionStartDate?: Date | null;
  promotionEndDate?: Date | null;
  promotionLabel?: string | null;
  promotionalMetrics?: {
    viewCount: number;
    conversionCount: number;
    marketingCost: number;
    acquisitionCost: number;
    costPrice: number; 
  }
  getFinalPrice(now?: Date): number;
  isPromotionActive(now?: Date): boolean;
};

const ComboGroupSchema = new Schema({
  title: { type: String, required: true },
  categoryId: { type: String, default: null },
  min: { type: Number, default: 0 },
  max: { type: Number, required: true },
  required: { type: Boolean, default: false },
  options: [
    {
      productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
      extraPrice: { type: Number, default: 0 },
      defaultSelected: { type: Boolean, default: false },
    },
  ],
});

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
  comboOptions: [ComboGroupSchema],
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
  discountPercentage: { type: Number, default: null },   
  promotionalPrice: { type: Number, default: null },     
  promotionStartDate: { type: Date, default: null },
  promotionEndDate: { type: Date, default: null },
  promotionLabel: { type: String, default: null },
  promotionalMetrics: {
    viewCount: { type: Number, default: 0 },
    conversionCount: { type: Number, default: 0 },
    marketingCost: { type: Number, default: 0 },
    acquisitionCost: { type: Number, default: 0 },
    costPrice: { type: Number, default: 0 }
  },
 }, 
 { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } 
});

// --- helpers locais (toque mínimo) ---
function isPromotionActiveDoc(doc: any, now = new Date()) {
  const hasDisc =
    typeof doc?.discountPercentage === "number" && doc.discountPercentage > 0;
  const hasPromoPrice =
    typeof doc?.promotionalPrice === "number" && doc.promotionalPrice > 0;

  const inWindow =
    (!doc?.promotionStartDate || new Date(doc.promotionStartDate) <= now) &&
    (!doc?.promotionEndDate || new Date(doc.promotionEndDate) >= now);

  return (hasDisc || hasPromoPrice) && inWindow;
}

function finalPriceDoc(doc: any, now = new Date()) {
  if (isPromotionActiveDoc(doc, now)) {
    if (typeof doc?.promotionalPrice === "number" && doc.promotionalPrice > 0) {
      return Number(Number(doc.promotionalPrice).toFixed(2));
    }
    if (typeof doc?.discountPercentage === "number" && doc.discountPercentage > 0) {
      const pct = Math.min(100, Math.max(0, doc.discountPercentage));
      return Number((Number(doc.price) * (1 - pct / 100)).toFixed(2));
    }
  }
  return Number(Number(doc.price).toFixed(2));
}


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

productSchema.methods.isPromotionActive = function (now = new Date()) {
  return isPromotionActiveDoc(this, now);
};

productSchema.methods.getFinalPrice = function (now = new Date()) {
  return finalPriceDoc(this, now);
};

productSchema.set("toJSON", {
  virtuals: false, 
  transform(doc: any, ret: any) {
    ret.isOnPromotion = doc.isPromotionActive();   
    ret.finalPrice = doc.getFinalPrice();           
    return ret;
  },
});

export const ProductModel = mongoose.model<IProduct>("Product", productSchema);

// Métodos
// Obter todos os produtos
export const getProducts = () => ProductModel.find();

// Obter produtos de um restaurante específico
export const getProductsByRestaurant = (restaurantId: string) =>
  ProductModel.find({ restaurant: restaurantId })
    .select('_id name price category image imageBlur imageWidth imageHeight isOnPromotion promotionalPrice promotionEndDate promotionLabel isCombo additionalOptions accompaniments description discountPercentage isAvailable');

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