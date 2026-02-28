import mongoose, { Document, Schema } from "mongoose";

// ─────────────────────────────────────────────
//  Categorias de serviço pré-definidas (sugestão)
//  O administrador é livre para criar qualquer
//  string de categoria — esta lista é apenas
//  referência para o frontend oferecer sugestões.
// ─────────────────────────────────────────────
export const SERVICE_CATEGORY_SUGGESTIONS = [
  "Cozinha",
  "Bar",
  "Bebidas",
  "Café da Manhã",
  "Frigobar",
  "Spa",
  "Lavanderia",
  "Serviços de Quarto",
  "Conveniência",
  "Entretenimento",
  "Transporte",
  "Outros",
] as const;

// ─────────────────────────────────────────────
//  Sub-interfaces
// ─────────────────────────────────────────────
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

export interface IPreparationOption {
  id: string;
  label: string;
  extraPrice?: number;
  isAvailable: boolean;
  defaultSelected?: boolean;
}

export interface IPreparationGroup {
  title: string;
  required: boolean;
  min: number;
  max: number;
  options: IPreparationOption[];
}

export interface ComboOption {
  name: string;
  products: mongoose.Types.ObjectId[];
}

// ─────────────────────────────────────────────
//  Interface principal
// ─────────────────────────────────────────────
export interface IProduct extends Document {
  /** Referência ao hotel (antigo "restaurant") */
  hotel: mongoose.Schema.Types.ObjectId;

  /**
   * Categoria do serviço — completamente livre.
   * Ex.: "Cozinha", "Spa", "Lavanderia", "Bar", ou qualquer valor
   * definido pelo administrador do estabelecimento.
   */
  category: string;

  /** Rótulo de sub-categoria opcional, para agrupamentos mais finos */
  subcategory?: string;

  image: string;
  imagePublicId?: string;
  imageBlur?: string;
  imageWidth?: number;
  imageHeight?: number;

  name: string;

  /**
   * Quantidade em estoque.
   * Para serviços sem controle de estoque, use -1 (ilimitado).
   */
  quantity: number;

  price: number;
  costPrice?: number;
  description: string;
  isAvailable: boolean;

  /** Tempo estimado de entrega/execução em minutos (opcional) */
  estimatedDeliveryMinutes?: number;

  /** Serviço é para consumo no quarto ou precisa de deslocamento do hóspede? */
  deliveryType?: "room_delivery" | "on_site" | "pickup";

  // Promoção
  isOnPromotion: boolean;
  promotionalPrice?: number;
  discountPercentage?: number | null;
  promotionStartDate?: Date | null;
  promotionEndDate?: Date | null;
  promotionLabel?: string | null;

  // Combos
  isCombo?: boolean;
  comboOptions?: ComboOption[];

  // Adicionais / acompanhamentos / grupos de preparo
  isAdditional?: boolean;
  hasAddons?: boolean;
  additionalOptions?: IAdditional[];
  accompaniments?: IAccompaniment[];
  preparationGroups?: IPreparationGroup[];

  promotionalMetrics?: {
    viewCount: number;
    conversionCount: number;
    marketingCost: number;
    acquisitionCost: number;
    costPrice: number;
  };

  // Métodos
  getFinalPrice(now?: Date): number;
  isPromotionActive(now?: Date): boolean;
}

// ─────────────────────────────────────────────
//  Sub-schemas
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  Schema principal
// ─────────────────────────────────────────────
const productSchema = new Schema<IProduct>(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    subcategory: {
      type: String,
      trim: true,
    },
    image: { type: String, default: "" },
    imagePublicId: { type: String },
    imageBlur: { type: String },
    imageWidth: { type: Number },
    imageHeight: { type: Number },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: -1, // -1 = ilimitado (serviços sem estoque)
    },
    price: {
      type: Number,
      required: true,
    },
    costPrice: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      default: "",
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    estimatedDeliveryMinutes: {
      type: Number,
    },
    deliveryType: {
      type: String,
      enum: ["room_delivery", "on_site", "pickup"],
      default: "room_delivery",
    },

    // Promoção
    isOnPromotion: { type: Boolean, default: false },
    discountPercentage: { type: Number, default: null },
    promotionalPrice: { type: Number, default: null },
    promotionStartDate: { type: Date, default: null },
    promotionEndDate: { type: Date, default: null },
    promotionLabel: { type: String, default: null },

    // Combos
    isCombo: { type: Boolean, default: false },
    comboOptions: [ComboGroupSchema],

    // Adicionais / acompanhamentos / preparo
    isAdditional: { type: Boolean, default: false },
    hasAddons: { type: Boolean, default: false },
    additionalOptions: [
      {
        id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        isAvailable: { type: Boolean, default: true },
      },
    ],
    accompaniments: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        isAvailable: { type: Boolean, default: true },
      },
    ],
    preparationGroups: [
      {
        title: { type: String, required: true },
        required: { type: Boolean, default: true },
        min: { type: Number, default: 1 },
        max: { type: Number, required: true },
        options: [
          {
            id: { type: mongoose.Schema.Types.ObjectId, auto: true },
            label: { type: String, required: true },
            extraPrice: { type: Number, default: 0 },
            isAvailable: { type: Boolean, default: true },
            defaultSelected: { type: Boolean, default: false },
          },
        ],
      },
    ],

    promotionalMetrics: {
      viewCount: { type: Number, default: 0 },
      conversionCount: { type: Number, default: 0 },
      marketingCost: { type: Number, default: 0 },
      acquisitionCost: { type: Number, default: 0 },
      costPrice: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─────────────────────────────────────────────
//  Índices
// ─────────────────────────────────────────────
productSchema.index({ hotel: 1, category: 1 });
productSchema.index({ hotel: 1, isAvailable: 1 });
productSchema.index({ hotel: 1, name: 1 }, { unique: true });

// ─────────────────────────────────────────────
//  Helpers de promoção (funções puras)
// ─────────────────────────────────────────────
function isPromotionActiveDoc(doc: any, now = new Date()): boolean {
  const hasDisc =
    typeof doc?.discountPercentage === "number" && doc.discountPercentage > 0;
  const hasPromoPrice =
    typeof doc?.promotionalPrice === "number" && doc.promotionalPrice > 0;

  const inWindow =
    (!doc?.promotionStartDate || new Date(doc.promotionStartDate) <= now) &&
    (!doc?.promotionEndDate || new Date(doc.promotionEndDate) >= now);

  return (hasDisc || hasPromoPrice) && inWindow;
}

function finalPriceDoc(doc: any, now = new Date()): number {
  if (isPromotionActiveDoc(doc, now)) {
    if (typeof doc?.promotionalPrice === "number" && doc.promotionalPrice > 0) {
      return Number(doc.promotionalPrice.toFixed(2));
    }
    if (typeof doc?.discountPercentage === "number" && doc.discountPercentage > 0) {
      const pct = Math.min(100, Math.max(0, doc.discountPercentage));
      return Number((Number(doc.price) * (1 - pct / 100)).toFixed(2));
    }
  }
  return Number(Number(doc.price).toFixed(2));
}

// ─────────────────────────────────────────────
//  Middlewares
// ─────────────────────────────────────────────

// Recalcula flag de promoção antes de salvar
productSchema.pre("save", function (next) {
  this.isOnPromotion = isPromotionActiveDoc(this);

  if (this.isOnPromotion && this.discountPercentage && this.price) {
    this.promotionalPrice = this.price - this.price * (this.discountPercentage / 100);
  }

  next();
});

// ─────────────────────────────────────────────
//  Métodos de instância
// ─────────────────────────────────────────────
productSchema.methods.isPromotionActive = function (now = new Date()): boolean {
  return isPromotionActiveDoc(this, now);
};

productSchema.methods.getFinalPrice = function (now = new Date()): number {
  return finalPriceDoc(this, now);
};

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

// ─────────────────────────────────────────────
//  toJSON — adiciona campos computados
// ─────────────────────────────────────────────
productSchema.set("toJSON", {
  virtuals: false,
  transform(_doc: any, ret: any) {
    ret.isOnPromotion = _doc.isPromotionActive();
    ret.finalPrice = _doc.getFinalPrice();
    return ret;
  },
});

// ─────────────────────────────────────────────
//  Model
// ─────────────────────────────────────────────
export const ProductModel = mongoose.model<IProduct>("Product", productSchema);

// ─────────────────────────────────────────────
//  Helpers de repositório
// ─────────────────────────────────────────────

/** Lista todos os produtos de um hotel */
export const getProductsByHotel = (hotelId: string) =>
  ProductModel.find({ hotel: hotelId }).select(
    "_id name price category subcategory image imageBlur imageWidth imageHeight " +
    "isOnPromotion promotionalPrice promotionEndDate promotionLabel " +
    "isCombo comboOptions additionalOptions accompaniments description " +
    "discountPercentage isAvailable deliveryType estimatedDeliveryMinutes"
  );

/** Lista produtos por categoria dentro de um hotel */
export const getProductsByCategory = (hotelId: string, category: string) =>
  ProductModel.find({ hotel: hotelId, category, isAvailable: true });

/**
 * Retorna as categorias distintas cadastradas para um hotel.
 * Útil para renderizar o menu de navegação no cliente.
 */
export const getDistinctCategories = (hotelId: string): Promise<string[]> =>
  ProductModel.distinct("category", { hotel: hotelId, isAvailable: true });

/** Lista produtos em promoção ativa de um hotel */
export const getPromotionalProducts = (hotelId: string) =>
  ProductModel.find({
    hotel: hotelId,
    $or: [
      { discountPercentage: { $gt: 0 } },
      { promotionalPrice: { $gt: 0 } },
    ],
    $and: [
      {
        $or: [
          { promotionStartDate: null },
          { promotionStartDate: { $lte: new Date() } },
        ],
      },
      {
        $or: [
          { promotionEndDate: null },
          { promotionEndDate: { $gte: new Date() } },
        ],
      },
    ],
  });

export const getProducts = () => ProductModel.find();
export const getProductById = (id: string) => ProductModel.findById(id);
export const getProductByName = (hotelId: string, name: string) =>
  ProductModel.findOne({ hotel: hotelId, name });

export const createProduct = (values: Record<string, any>) =>
  new ProductModel(values).save().then((p) => p.toObject());

export const deleteProduct = (id: string) =>
  ProductModel.findOneAndDelete({ _id: id });

export const updateProduct = async (id: string, values: Record<string, any>) => {
  const doc = await ProductModel.findById(id);
  if (!doc) return null;

  Object.assign(doc, values);

  const promotionActive = isPromotionActiveDoc(doc);
  doc.isOnPromotion = promotionActive;

  if (promotionActive) {
    if (doc.discountPercentage && !doc.promotionalPrice) {
      doc.promotionalPrice = doc.price - doc.price * (doc.discountPercentage / 100);
    }
    if (doc.promotionalPrice && !doc.discountPercentage) {
      doc.discountPercentage = Math.round(
        ((doc.price - doc.promotionalPrice) / doc.price) * 100
      );
    }
  } else {
    doc.promotionalPrice = undefined;
    doc.discountPercentage = undefined;
    doc.promotionStartDate = undefined;
    doc.promotionEndDate = undefined;
  }

  return doc.save();
};