import jwt from "jsonwebtoken";
import crypto from 'crypto';
import { Request, Response } from "express";
import { UserModel, getUserByEmail, createUser } from "../models/User";
import { RestaurantModel } from "../models/Restaurant";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import { authentication } from "../helpers";
import { generateHash, generateSalt } from "../utils/generateSalt";
import mongoose from "mongoose";
import { resolveRestaurantForUser } from "../utils/resolveRestaurant";

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
  const restaurantId = asStringId(user.restaurant);
  const unitId = asStringId(user.restaurantUnit);

  const payload = {
    sub: asStringId(user._id),
    role: String(user.role || ""),
    restaurantId,
    unitId,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  return { token, payload };
}


// Login para restaurante (admin)
export const loginAdminHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    console.log("Request body:", req.body);

    if (!email || !password) {
      console.log("Campos obrigatórios faltando");
      return res
        .status(400)
        .json({ message: "E-mail e senha são obrigatórios" });
    }

    console.log("Buscando usuário ADMIN com email:", email);
    // Incluir o campo restaurant na busca
    const user = await UserModel.findOne({
      email,
      role: "ADMIN"
    }).select('+authentication.password +authentication.salt +restaurant');
    console.log("Usuário encontrado:", user ? "Sim" : "Não");

    if (user) {
      console.log("Verificando credenciais do usuário ADMIN");
      if (!user.authentication || !user.authentication.salt) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      const expectedHash = authentication(user.authentication.salt, password);

      if (expectedHash !== user.authentication.password) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      const jwtResult = issueJWT(user);
  
      user.authentication.sessionToken = jwtResult.token;
      await user.save();

      // Incluir o restaurantId na resposta
      const { token } = issueJWT(user);
      return res.status(200).json({
        message: "Login realizado com sucesso",
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: "ADMIN",
          restaurantId: user.restaurant // ID do restaurante vinculado ao usuário
        },
        token,
      });
    }

  } catch (error: any) {
    console.error("Erro ao realizar login de administrador:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// login
export const loginHandler = async (req: Request, res: Response): Promise<Response> => {
  try {
    let { email, cpf, password, identifier } = (req.body || {}) as {
      email?: string;
      cpf?: string;
      password?: string;
      identifier?: string;
    };

    if (!email && !cpf && identifier) {
      const id = String(identifier).trim();
      if (/\S+@\S+\.\S+/.test(id)) email = id.toLowerCase();
      else cpf = normalizeCPF(id);
    }

    if ((!email && !cpf) || !password) {
      return res.status(400).json({ message: "E-mail ou CPF e senha são obrigatórios" });
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
      "+authentication.password +authentication.salt +role +restaurant +restaurantUnit +email +firstName +lastName +cpf"
    );

    if (!user) {
      if (DEBUG) console.warn("[AUTH][login] user not found for query:", query);
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    if (!user?.authentication?.salt || !user?.authentication?.password) {
      if (DEBUG) console.warn("[AUTH][login] user has no salt/password:", user._id.toString());
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const { restaurantId, restaurantName, unitId } = await resolveRestaurantForUser(user);

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
          // log seguro: só prefixo p/ não vazar hash completo
          expectedPrefix: expected.slice(0, 8),
          storedPrefix: stored.slice(0, 8),
        });
      }
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

      const token = jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      restaurantId: restaurantId ?? null,
      restaurantName: restaurantName ?? null,
      unitId: unitId ?? null,
    },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

    await UserModel.findByIdAndUpdate(user._id, {
      "authentication.sessionToken": token
    });
    await user.save();

    return res.status(200).json({
      message: "Login realizado com sucesso",
      user: { _id: String(user._id), role: user.role },
      restaurant: restaurantId ? { _id: restaurantId, name: restaurantName } : null,
      unit: unitId ? { _id: unitId } : null,
      token,
    });
  } catch (error: any) {
    console.error("[AUTH][login] error:", error);
    return res.status(500).json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Registrar um novo restaurante
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
      socialName,
      cnpj,
      specialty,
      address,
      businessHours
    } = req.body;

    // Validar campos obrigatórios
    if (!firstName || !lastName || !email || !password || !name || !cpf || !cnpj) {
      return res.status(400).json({ message: "Todos os campos obrigatórios devem ser preenchidos" });
    }

    // Verificar se o email já está em uso
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "Este e-mail já está em uso" });
    }

    // Verificar se o nome do restaurante já está em uso
    const existingRestaurantByName = await RestaurantModel.findOne({
      name: { $regex: new RegExp('^' + name + '.*', 'i') }
    });

    if (existingRestaurantByName) {
      return res.status(400).json({ message: "Este nome de restaurante já está em uso" });
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

    // Criar o restaurante
    const restaurantData = {
      name,
      logo: "",
      cnpj,
      socialName: socialName || name,
      address: address || {
        zipCode: "",
        street: "",
        number: 0,
        complement: ""
      },
      specialty: specialty || "",
      phone: phone || "",
      admin: {
        fullName: firstName + " " + lastName,
        cpf,
        email,
        phone: phone || ""
      },
      authentication: {
        password: hash,
        salt,
        sessionToken: ""
      },
      units: [],
      attendants: [],
      businessHours: businessHours || [],
    };

    const restaurant = new RestaurantModel(restaurantData);
    const savedRestaurant = await restaurant.save();

    if (!savedRestaurant) {
      console.error("Falha ao salvar o restaurante");
      throw new Error("Falha ao criar o restaurante");
    }

    // Atualizar o usuário com referência ao restaurante
    await UserModel.findByIdAndUpdate(adminUser._id, {
      restaurant: savedRestaurant._id
    });

    // Criar a unidade de restaurante
    const unitData = {
      name: savedRestaurant.name,
      address: savedRestaurant.address,
      cnpj: savedRestaurant.cnpj,
      socialName: savedRestaurant.socialName,
      phone: savedRestaurant.phone,
      manager: [],
      attendants: [],
      restaurant: savedRestaurant._id
    };

    const restaurantUnit = new RestaurantUnitModel(unitData);
    const savedUnit = await restaurantUnit.save();

    // Adicionar a unidade ao restaurante
    await RestaurantModel.findByIdAndUpdate(savedRestaurant._id, {
      $push: { units: savedUnit._id }
    });

    // Gerar token JWT usando a nova função
    const { token } = issueJWT(adminUser);

    // Atualizar token de sessão no usuário e no restaurante
    await UserModel.findByIdAndUpdate(adminUser._id, {
      "authentication.sessionToken": token
    });

    await RestaurantModel.findByIdAndUpdate(savedRestaurant._id, {
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
      message: "Restaurante, usuário admin e unidade criados com sucesso",
      user: {
        _id: adminUser._id,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        email: adminUser.email,
        role: "ADMIN",
      },
      restaurant: {
        _id: savedRestaurant._id,
        name: savedRestaurant.name,
      },
      unit: {
        _id: savedUnit._id,
        name: savedUnit.name,
      },
      token,
      tokenExpiry,
    });
  } catch (error: any) {
    console.error("Erro ao registrar restaurante:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Registrar um novo cliente (usuário final)
export const registerClientHandler = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, cpf, phone, tableId, restaurantUnitId } = req.body;

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

    // Verificar se a unidade do restaurante existe
    if (restaurantUnitId) {
      const restaurantUnit = await RestaurantUnitModel.findById(restaurantUnitId);
      if (!restaurantUnit) {
        return res
          .status(400)
          .json({ message: "Unidade de restaurante não encontrada" });
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

    // Se tiver tableId e restaurantUnitId, salvar no localStorage (frontend)
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
      restaurantUnitId,
      tableId,
    });
  } catch (error: any) {
    console.error("Erro ao registrar cliente:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Registrar um manager (por um restaurante)
export const registerManagerHandler = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, cpf, phone, restaurantUnitId } = req.body;

    // Validar campos obrigatórios
    if (!firstName || !lastName || !email || !password || !restaurantUnitId || !cpf) {
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

    // Verificar se a unidade do restaurante existe
    const restaurantUnit = await RestaurantUnitModel.findById(restaurantUnitId);
    if (!restaurantUnit) {
      return res
        .status(400)
        .json({ message: "Unidade de restaurante não encontrada" });
    }

    // Verificar se o usuário atual é um restaurante admin
    if (!req.isRestaurantAdmin || !req.restaurant) {
      return res
        .status(403)
        .json({ message: "Apenas administradores de restaurante podem cadastrar gerentes" });
    }

    // Verificar se a unidade pertence ao restaurante
    const restaurantId = req.restaurant._id;
    const unitBelongsToRestaurant = await RestaurantModel.findOne({
      _id: restaurantId,
      units: restaurantUnitId
    });

    if (!unitBelongsToRestaurant) {
      return res
        .status(403)
        .json({ message: "Esta unidade não pertence ao seu restaurante" });
    }

    // Criar hash da senha
    const salt = generateSalt();
    const hash = generateHash(password, salt);

    // Criar o novo usuário com role MANAGER
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
      role: "MANAGER",
      orders: [],
      restaurant: restaurantId,
      restaurantUnit: restaurantUnitId
    });

    // Atualizar a unidade do restaurante com o novo gerente
    restaurantUnit.manager = `${firstName} ${lastName}`;
    await restaurantUnit.save();

    return res.status(201).json({
      message: "Gerente criado com sucesso",
      user: {
        _id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        role: newUser.role,
      }
    });
  } catch (error: any) {
    console.error("Erro ao registrar gerente:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

// Registrar um atendente (por um admin de restaurante ou gerente)
export const registerAttendantHandler = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, cpf, phone, restaurantUnitId } = req.body;

    // Validar campos obrigatórios
    if (!firstName || !lastName || !email || !password || !restaurantUnitId || !cpf) {
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

    // Verificar se a unidade do restaurante existe
    const restaurantUnit = await RestaurantUnitModel.findById(restaurantUnitId);
    if (!restaurantUnit) {
      return res
        .status(400)
        .json({ message: "Unidade de restaurante não encontrada" });
    }

    // Verificar se o usuário atual é admin do restaurante ou gerente
    let restaurantId;

    if (req.isRestaurantAdmin && req.restaurant) {
      // Admin do restaurante
      restaurantId = req.restaurant._id;

      // Verificar se a unidade pertence ao restaurante
      const unitBelongsToRestaurant = await RestaurantModel.findOne({
        _id: restaurantId,
        units: restaurantUnitId
      });

      if (!unitBelongsToRestaurant) {
        return res
          .status(403)
          .json({ message: "Esta unidade não pertence ao seu restaurante" });
      }
    } else if (req.user && req.user.role === "MANAGER") {
      // Gerente
      restaurantId = req.user.restaurantId;

      // Verificar se o gerente é responsável por esta unidade
      if (req.user.unitId?.toString() !== restaurantUnitId) {
        return res
          .status(403)
          .json({ message: "Você só pode cadastrar atendentes para sua unidade" });
      }
    } else {
      return res
        .status(403)
        .json({ message: "Acesso negado. Apenas administradores e gerentes podem cadastrar atendentes" });
    }

    // Criar hash da senha
    const salt = generateSalt();
    const hash = generateHash(password, salt);

    // Criar o novo usuário com role ATTENDANT
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
      role: "ATTENDANT",
      orders: [],
      restaurant: restaurantId,
      restaurantUnit: restaurantUnitId
    });

    // Atualizar a unidade do restaurante com o novo atendente
    await RestaurantUnitModel.findByIdAndUpdate(
      restaurantUnitId,
      { $push: { attendants: newUser._id } }
    );

    return res.status(201).json({
      message: "Atendente criado com sucesso",
      user: {
        _id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        role: newUser.role,
      }
    });
  } catch (error: any) {
    console.error("Erro ao registrar atendente:", error);
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
      .select("firstName lastName email role restaurant restaurantUnit")
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
        unitId: user.restaurantUnit ? String(user.restaurantUnit) : null,
      } as const,
      restaurant: null as null | { _id: string; name: string },
      units: [] as Array<{ _id: string; name: string }>,
    };

    // Para ADMIN/MANAGER, retornamos o restaurante e as unidades (se existirem)
    if (user.role === "ADMIN" || user.role === "MANAGER") {
      if (user.restaurant) {
        const restaurant = await RestaurantModel.findById(user.restaurant)
          .select("_id name units")
          .lean();

        if (restaurant) {
          base.restaurant = { _id: String(restaurant._id), name: restaurant.name };

          if (Array.isArray(restaurant.units) && restaurant.units.length > 0) {
            const units = await RestaurantUnitModel.find({
              _id: { $in: restaurant.units },
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

// Logout para usuários e restaurantes
export const logoutHandler = async (req: Request, res: Response) => {
  try {
    if (req.isRestaurantAdmin && req.restaurant) {
      // Logout de restaurante
      await RestaurantModel.findByIdAndUpdate(req.restaurant._id, {
        "authentication.sessionToken": ""
      });
    } else if (req.user) {
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

// Validação para convidados (guest token)
export const validateGuestTokenHandler = async (req: Request, res: Response) => {
  try {
    const { guestToken, tableId, restaurantId } = req.body;

    if (!guestToken || !tableId || !restaurantId) {
      return res.status(400).json({
        isValid: false,
        message: "Token de convidado, ID da mesa e ID do restaurante são obrigatórios"
      });
    }

    // Buscar informações do restaurante
    const restaurant = await RestaurantModel.findById(restaurantId);

    if (!restaurant) {
      return res.status(404).json({
        isValid: false,
        message: "Restaurante não encontrado"
      });
    }

    return res.status(200).json({
      isValid: true,
      guestInfo: {
        tableId,
        restaurantId,
        restaurantName: restaurant.name,
        isGuest: true
      }
    });
  } catch (error: any) {
    console.error("Erro ao validar token de convidado:", error);
    return res.status(500).json({
      isValid: false,
      message: "Erro interno do servidor",
      error: error.message
    });
  }
};