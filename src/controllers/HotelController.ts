// controllers/HotelController.ts
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { HotelModel } from "../models/Hotel";
import { HotelUnitModel } from "../models/HotelUnit";
import { UserModel, createUser, getUserByEmail } from "../models/User";
import { generateHash, generateSalt } from "../utils/generateSalt";

const JWTSECRET = process.env.JWT_SECRET || "your-default-secret-key";

function asStringId(id: any): string | null {
  if (!id) return null;
  // aceita: ObjectId, {_id}, string
  if (typeof id === "string") return id;
  if (id instanceof mongoose.Types.ObjectId) return String(id);
  if (typeof id === "object" && id._id) return String(id._id);
  return null;
}

function issueJWT(user: any) {
  const restaurantId = asStringId(user.restaurant);
  const unitId = asStringId(user.restaurantUnit);

  const payload = {
    sub: asStringId(user._id),
    role: String(user.role || ""),
    restaurantId,
    unitId,
  };

  const token = jwt.sign(payload, JWTSECRET, { expiresIn: "7d" });
  return { token, payload };
}

/**
 * Registrar Admin + Hotel + Unidade inicial
 */
export const registerAdminWithHotel = async (req: Request, res: Response) => {
  try {
    const {
      // Dados do usuário
      firstName,
      lastName,
      cpf,
      email,
      password,
      phone,
      // Dados do hotel
      name,
      description,
      logo,
      address,
      contact
    } = req.body;

    // Validar campos obrigatórios
    if (!firstName || !lastName || !email || !password || !name || !cpf) {
      return res.status(400).json({ message: "Todos os campos obrigatórios devem ser preenchidos" });
    }

    // Verificar se o email já está em uso
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "Este e-mail já está em uso" });
    }

    // Verificar se o nome do hotel já está em uso
    const existingHotelByName = await HotelModel.findOne({
      name: { $regex: new RegExp('^' + name + '.*', 'i') }
    });

    if (existingHotelByName) {
      return res.status(400).json({ message: "Este nome de hotel já está em uso" });
    }

    // Criar slug a partir do nome
    const slug = name.toLowerCase()
      .replace(/[àáâãäå]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Verificar se o slug já existe
    const existingSlug = await HotelModel.findOne({ slug });
    if (existingSlug) {
      return res.status(400).json({ message: "Este nome gera um identificador já existente" });
    }

    // Criar o usuário ADMIN
    const salt = generateSalt();
    const hash = generateHash(password, salt);

    const adminUser = await createUser({
      firstName,
      lastName,
      email,
      cpf,
      phone: phone || "",
      authentication: {
        salt,
        password: hash,
        sessionToken: "",
      },
      role: "ADMIN",
    });

    // Criar o hotel
    const hotel = new HotelModel({
      name,
      slug,
      description: description || "",
      logo: logo || "",
      address: address || {
        street: "",
        number: "",
        city: "",
        state: "",
        zipCode: ""
      },
      contact: contact || {
        phone: phone || "",
        email: email
      },
      owner: adminUser._id,
      units: []
    });

    const savedHotel = await hotel.save();

    if (!savedHotel) {
      console.error("Falha ao salvar o hotel");
      throw new Error("Falha ao criar o hotel");
    }

    // Atualizar o usuário com referência ao hotel
    await UserModel.findByIdAndUpdate(adminUser._id, {
      hotel: savedHotel._id
    });

    // Criar a unidade inicial do hotel (ex: "Bloco Principal")
    const unit = new HotelUnitModel({
      hotel: savedHotel._id,
      name: "Bloco Principal",
      description: "Unidade principal do hotel",
      roomNumberingFormat: "SIMPLE",
      rooms: [],
      orders: []
    });

    const savedUnit = await unit.save();

    // Adicionar a unidade ao hotel
    await HotelModel.findByIdAndUpdate(savedHotel._id, {
      $push: { units: savedUnit._id }
    });

    // Gerar token JWT
    const { token } = issueJWT(adminUser);

    // Atualizar token de sessão no usuário
    await UserModel.findByIdAndUpdate(adminUser._id, {
      "authentication.sessionToken": token
    });

    let tokenExpiry: number | null = null;
    try {
      const decoded = jwt.decode(token) as jwt.JwtPayload | null;
      if (decoded?.exp) tokenExpiry = decoded.exp * 1000;
    } catch {
      tokenExpiry = null;
    }

    return res.status(201).json({
      message: "Hotel, usuário admin e unidade criados com sucesso",
      user: {
        _id: adminUser._id,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        email: adminUser.email,
        role: "ADMIN",
      },
      hotel: {
        _id: savedHotel._id,
        name: savedHotel.name,
        slug: savedHotel.slug,
      },
      unit: {
        _id: savedUnit._id,
        name: savedUnit.name,
      },
      token,
      tokenExpiry,
    });
  } catch (error: any) {
    console.error("Erro ao registrar hotel:", error);
    return res.status(500).json({ message: "Erro interno do servidor", error: error.message });
  }
};

/**
 * Criar unidade do hotel (bloco/ala)
 */
export const createHotelUnit = async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    const { name, description, roomNumberingFormat, rooms } = req.body;
    
    const unit = new HotelUnitModel({
      hotel: hotelId,
      name,
      description,
      roomNumberingFormat,
      rooms: rooms || []
    });
    
    await unit.save();
    
    // Atualizar hotel com a nova unidade
    await HotelModel.findByIdAndUpdate(
      hotelId,
      { $push: { units: unit._id } }
    );
    
    return res.status(201).json(unit);
  } catch (error: any) {
    console.error("Erro ao criar unidade:", error);
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Adicionar quartos a uma unidade
 */
export const addRoomsToUnit = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const { rooms } = req.body; // Array de objetos com roomId, displayName, floor, sector
    
    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }
    
    // Adicionar quartos
    const newRooms = rooms.map((room: any) => ({
      roomId: room.roomId,
      displayName: room.displayName,
      floor: room.floor,
      sector: room.sector,
      isActive: true
    }));
    
    unit.rooms.push(...newRooms);
    await unit.save();
    
    return res.status(200).json(unit);
  } catch (error: any) {
    console.error("Erro ao adicionar quartos:", error);
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Gerar QR Codes para quartos
 */
export const generateRoomQRCodes = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const { roomIds } = req.body; // Array de roomIds para gerar QR Codes
    
    const unit = await HotelUnitModel.findById(unitId).populate('hotel');
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }
    
    const hotel = unit.hotel as any;
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    
    const qrCodes: Array<{ roomId: string; qrCodeUrl: string; qrCodeDataUrl: string }> = [];
    
    for (const roomId of roomIds) {
      const room = unit.rooms.find(r => r.roomId === roomId);
      if (!room) continue;
      
      // URL do QR Code: /[hotelSlug]/room/[roomId]
      const qrUrl = `${baseUrl}/${hotel.slug}/room/${roomId}`;
      
      // Gerar QR Code como Data URL
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2
      });
      
      // Atualizar o quarto com a URL do QR Code
      room.qrCode = qrUrl;
      
      qrCodes.push({
        roomId: room.roomId,
        qrCodeUrl: qrUrl,
        qrCodeDataUrl
      });
    }
    
    await unit.save();
    
    return res.status(200).json({
      message: "QR Codes gerados com sucesso",
      qrCodes
    });
  } catch (error: any) {
    console.error("Erro ao gerar QR Codes:", error);
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Obter hotel por slug
 */
export const getHotelBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    const hotel = await HotelModel.findOne({ slug }).populate('units');
    if (!hotel) {
      return res.status(404).json({ message: "Hotel não encontrado" });
    }
    
    return res.status(200).json(hotel);
  } catch (error: any) {
    console.error("Erro ao buscar hotel:", error);
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Listar todos os quartos de uma unidade
 */
export const listUnitRooms = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    
    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }
    
    return res.status(200).json({
      unitName: unit.name,
      roomNumberingFormat: unit.roomNumberingFormat,
      rooms: unit.rooms
    });
  } catch (error: any) {
    console.error("Erro ao listar quartos:", error);
    return res.status(500).json({ message: error.message });
  }
};