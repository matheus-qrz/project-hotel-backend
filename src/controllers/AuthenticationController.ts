import jwt from "jsonwebtoken";
import crypto from 'crypto';
import { Request, Response } from "express";
import { UserModel, getUserByEmail, createUser } from "../models/User";
import { HotelModel } from "../models/Hotel";
import { HotelUnitModel } from "../models/HotelUnit";
import { generateHash, generateSalt } from "../utils/generateSalt";
import mongoose from "mongoose";
import { resolveHotelForUser } from "../utils/resolveHotelForUser";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_in_production";
const DEBUG = process.env.DEBUG_AUTH === "1";

function tSafeEqHex(aHex: string, bHex: string) {
  const a = Buffer.from(String(aHex).toLowerCase(), "hex");
  const b = Buffer.from(String(bHex).toLowerCase(), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function asStringId(id: any): string | null {
  if (!id) return null;
  // aceita: ObjectId, {_id}, string
  if (typeof id === "string") return id;
  if (id instanceof mongoose.Types.ObjectId) return String(id);
  if (typeof id === "object" && id._id) return String(id._id);
  return null;
}

function normalizeCPF(v: string) {
  return v.replace(/\D/g, "");
}

function issueJWT(user: any) {
  const hotelId = asStringId(user.hotel);
  const unitId = asStringId(user.unit);

  const payload = {
    sub: asStringId(user._id),
    role: String(user.role || ""),
    hotelId,
    unitId,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  return { token, payload };
}

// login
export const loginHandler = async (req: Request, res: Response): Promise<Response> => {
  try {
    let { email, cpf, password, identifier } = (req.body || {}) as {
      email?: string;
      cpf?: string;
      password?: string;
      identifier?: string;
    };

    // permitir "identifier" como entrada única
    if (!email && !cpf && identifier) {
      const id = String(identifier).trim();
      if (/\S+@\S+\.\S+/.test(id)) email = id.toLowerCase();
      else cpf = normalizeCPF(id);
    }

    // a partir daqui: email ou cpf é obrigatório
    if (!email && !cpf) {
      return res
        .status(400)
        .json({ message: "E-mail ou CPF é obrigatório" });
    }

    const normalizedEmail = (email ?? "").toLowerCase().trim();
    const cpfDigits = normalizeCPF(cpf ?? "");

    const query = normalizedEmail
      ? { email: normalizedEmail }
      : {
          $or: [
            { cpf: cpfDigits },
            { cpf: new RegExp("^" + cpfDigits.split("").join("\\D*") + "$") },
          ],
        };

    const user = await UserModel.findOne(query).select(
      "+authentication.password +authentication.salt +role +hotel +unit +email +firstName +lastName +cpf"
    );

    if (!user) {
      if (DEBUG) console.warn("[AUTH][login] user not found for query:", query);
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    if (!user?.authentication?.salt || !user?.authentication?.password) {
      if (DEBUG)
        console.warn(
          "[AUTH][login] user has no salt/password:",
          user._id.toString()
        );
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    // BUSCA HOTEL + UNIDADE via helper (reaproveita lógica do login atual)
    const { hotelId: hId, hotelName: hName, hotelSlug, unitId: uId } =
      await resolveHotelForUser(user);

    const hotelData = hId
      ? { _id: hId, name: hName!, slug: hotelSlug! }
      : null;
    const unitData = uId ? { _id: uId } : null;

    // --- NOVO: fluxo de validação de senha / garçom sem senha ---
    if (password && String(password).trim().length > 0) {
      // fluxo padrão com senha (ADMIN, MANAGER, etc.)
      const salt = String(user.authentication.salt);
      const stored = String(user.authentication.password).toLowerCase();

      // Cálculo EXATO usado no cadastro
      const expected = generateHash(String(password), salt).toLowerCase();

      const ok = tSafeEqHex(expected, stored);
      if (!ok) {
        if (DEBUG) {
          console.warn("[AUTH][login] password mismatch", {
            userId: user._id.toString(),
            email: user.email,
            expectedPrefix: expected.slice(0, 8),
            storedPrefix: stored.slice(0, 8),
          });
        }
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
    } else {
      // sem senha: só permitimos para GARÇOM (ATTENDANT)
      if (String(user.role).toUpperCase() !== "ATTENDANT") {
        if (DEBUG) {
          console.warn("[AUTH][login] missing password for non-attendant user", {
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
          });
        }
        return res
          .status(401)
          .json({ message: "Senha obrigatória para este usuário" });
      }
      // se for ATTENDANT, seguimos sem verificar senha
    }

    const token = jwt.sign(
      {
        sub: String(user._id),
        role: user.role,
        hotelId: hotelData ? hotelData._id : null,
        hotelName: hotelData ? hotelData.name : null,
        hotelSlug: hotelData ? hotelData.slug : null,
        unitId: unitData ? unitData._id : null,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    await UserModel.findByIdAndUpdate(user._id, {
      "authentication.sessionToken": token,
    });
    await user.save();

    return res.status(200).json({
      message: "Login realizado com sucesso",
      user: {
        _id: String(user._id),
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(" ") || "",
        email: user.email,
        cpf: user.cpf,
      },
      hotel: hotelData,
      unit: unitData,
      token,
    });
  } catch (error: any) {
    console.error("[AUTH][login] error:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Registrar um novo hotel
export const registerAdminWithRestaurantHandler = async (req: Request, res: Response) => {  
  try {
    const {
      firstName,
      lastName,
      cpf,
      email,
      password,
      phone,
      name,
      description,
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

    // Verificar se o slug do hotel já está em uso
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const existingHotelBySlug = await HotelModel.findOne({ slug });

    if (existingHotelBySlug) {
      return res.status(400).json({ message: "Este nome de hotel já está em uso" });
    }

    // Criar o usuário ADMIN usando as novas funções
    const salt = generateSalt(); // Nova função
    const hash = generateHash(password, salt); // Nova função

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
    const hotelData = {
      name,
      slug,
      description: description || "",
      logo: "",
      address: address || {
        street: "",
        number: "",
        city: "",
        state: "",
        zipCode: ""
      },
      contact: contact || {
        phone: phone || "",
        email: email || ""
      },
      owner: adminUser._id,
      units: [],
    };

    const hotel = new HotelModel(hotelData);
    const savedHotel = await hotel.save();

    if (!savedHotel) {
      console.error("Falha ao salvar o hotel");
      throw new Error("Falha ao criar o hotel");
    }

    // Atualizar o usuário com referência ao hotel
    await UserModel.findByIdAndUpdate(adminUser._id, {
      hotel: savedHotel._id
    });

    // Criar a unidade de hotel
    const unitData = {
      hotel: savedHotel._id,
      name: savedHotel.name,
      description: description || "",
      roomNumberingFormat: "SIMPLE" as const,
      rooms: [],
      orders: [],
    };

    const hotelUnit = new HotelUnitModel(unitData);
    const savedUnit = await hotelUnit.save();

    // Adicionar a unidade ao hotel
    await HotelModel.findByIdAndUpdate(savedHotel._id, {
      $push: { units: savedUnit._id }
    });

    // Atualizar o usuário com referência à unidade
    await UserModel.findByIdAndUpdate(adminUser._id, {
      unit: savedUnit._id
    });

    // Gerar token JWT usando a nova função
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
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Registrar um novo cliente (usuário final)
export const registerClientHandler = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, cpf, phone, roomId, hotelUnitId } = req.body;

    // Validar campos obrigatórios
    if (!firstName || !lastName || !email || !password || !cpf) {
      return res
        .status(400)
        .json({ message: "Todos os campos são obrigatórios" });
    }

    // Verificar se o email já está em uso
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Este e-mail já está em uso" });
    }

    // Verificar se a unidade do hotel existe
    if (hotelUnitId) {
      const hotelUnit = await HotelUnitModel.findById(hotelUnitId);
      if (!hotelUnit) {
        return res
          .status(400)
          .json({ message: "Unidade de hotel não encontrada" });
      }
    }

    // Criar hash da senha
    const salt = generateSalt();
    const hash = generateHash(password, salt);

    // Criar o novo usuário com role CLIENT
    const newUser = await createUser({
      firstName,
      lastName,
      email,
      cpf,
      phone: phone || "",
      authentication: {
        password: hash,
        salt,
        sessionToken: "",
      },
      role: "CLIENT",
      orders: [],
    });

    // Gerar token JWT para autenticação imediata
    if (!newUser.email || !newUser.role) {
      throw new Error("Email or role is undefined for the new user.");
    }
    const { token } = issueJWT(newUser);

    // Atualizar token de sessão no banco de dados
    await UserModel.findByIdAndUpdate(newUser._id, {
      "authentication.sessionToken": token
    });

    // Se tiver roomId e hotelUnitId, salvar no localStorage (frontend)
    return res.status(201).json({
      message: "Usuário criado com sucesso",
      user: {
        _id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        role: newUser.role,
      },
      token,
      hotelUnitId,
      roomId,
    });
  } catch (error: any) {
    console.error("Erro ao registrar cliente:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Verificar token JWT (útil para validação de sessão)
export const validateTokenHandler = async (req: Request, res: Response) => {
  try {
    // requer que o middleware isAuthenticated tenha populado req.user
    if (!req.user?.id) {
      return res.status(401).json({ isValid: false, message: "Não autenticado" });
    }

    // Pegamos os dados básicos do usuário para devolver ao front
    const user = await UserModel.findById(req.user.id)
      .select("firstName lastName email role hotel unit")
      .lean();

    if (!user) {
      return res.status(401).json({ isValid: false, message: "Usuário inválido" });
    }

    // Resposta base (válida para qualquer papel)
    const base = {
      isValid: true,
      user: {
        _id: req.user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        unitId: user.unit ? String(user.unit) : null,
      } as const,
      hotel: null as null | { _id: string; name: string },
      units: [] as Array<{ _id: string; name: string }>,
    };

    // Para ADMIN/MANAGER, retornamos o hotel e as unidades (se existirem)
    if (user.role === "ADMIN" || user.role === "MANAGER") {
      if (user.hotel) {
        const hotel = await HotelModel.findById(user.hotel)
          .select("_id name units")
          .lean();

        if (hotel) {
          base.hotel = { _id: String(hotel._id), name: hotel.name };

          if (Array.isArray(hotel.units) && hotel.units.length > 0) {
            const units = await HotelUnitModel.find({
              _id: { $in: hotel.units },
            })
              .select("_id name")
              .lean();

            base.units = units.map((u) => ({ _id: String(u._id), name: u.name }));
          }
        }
      }
    }

    return res.status(200).json(base);
  } catch (error: any) {
    console.error("Erro ao validar token:", error);
    return res
      .status(500)
      .json({ isValid: false, message: "Erro interno do servidor" });
  }
};

// Logout para usuários
export const logoutHandler = async (req: Request, res: Response) => {
  try {
    if (req.user) {
      // Logout de usuário
      await UserModel.findByIdAndUpdate(req.user.id, {
        "authentication.sessionToken": ""
      });
    } else {
      return res.status(401).json({ message: "Usuário não autenticado" });
    }

    return res.status(200).json({ message: "Logout realizado com sucesso" });
  } catch (error: any) {
    console.error("Erro ao realizar logout:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Validação para hóspedes (guest token)
export const validateGuestTokenHandler = async (req: Request, res: Response) => {
  try {
    const { guestToken, roomId, hotelId } = req.body;

    if (!guestToken || !roomId || !hotelId) {
      return res.status(400).json({
        isValid: false,
        message: "Token de hóspede, ID do quarto e ID do hotel são obrigatórios"
      });
    }

    // Buscar informações do hotel
    const hotel = await HotelModel.findById(hotelId);

    if (!hotel) {
      return res.status(404).json({
        isValid: false,
        message: "Hotel não encontrado"
      });
    }

    return res.status(200).json({
      isValid: true,
      guestInfo: {
        roomId,
        hotelId,
        hotelName: hotel.name,
        isGuest: true
      }
    });
  } catch (error: any) {
    console.error("Erro ao validar token de hóspede:", error);
    return res.status(500).json({
      isValid: false,
      message: "Erro interno do servidor",
      error: error.message
    });
  }
};