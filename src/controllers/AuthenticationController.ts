import { Request, Response } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { UserModel, getUserByEmail, createUser } from "../models/User";
import { RestaurantModel, getRestaurantByEmail } from "../models/Restaurant";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import { random } from "lodash";
import { authentication } from "../helpers";
import { generateHash, generateSalt } from "../utils/generateSalt";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_in_production";

const issueJWT = (id: string, email: string, role: string, expiresIn = "7d") => {
  const payload = {
    sub: id,
    email,
    role,
    iat: Date.now(),
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn });
  return token;
};

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

      const token = issueJWT(
        user._id.toString(),
        user.email || "",
        "ADMIN"
      );

      user.authentication.sessionToken = token;
      await user.save();

      // Incluir o restaurantId na resposta
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

    // Resto do código para login via restaurant permanece igual
    const restaurant = await getRestaurantByEmail(email);
    // ...

  } catch (error: any) {
    console.error("Erro ao realizar login de administrador:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};

export const loginHandler = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "E-mail e senha são obrigatórios" });
    }

    // Buscar usuário pelo email com populate do restaurante
    const user = await UserModel.findOne({ email })
      .select('+authentication.password +authentication.salt +restaurant +restaurantUnit')
      .populate('restaurant'); // Adicionar populate

    if (!user) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    if (!user.authentication || !user.authentication.salt) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const expectedHash = generateHash(password, user.authentication.salt);

    if (expectedHash !== user.authentication.password) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const token = issueJWT(user._id.toString(), user.email || "", user.role || '');

    user.authentication.sessionToken = token;
    await user.save();

    // Preparar resposta base
    const response: any = {
      token,
      user: {
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      }
    };

    // Adicionar informações do restaurante para ADMIN e MANAGER
    if (user.role === "ADMIN" || user.role === "MANAGER") {
      const restaurant = await RestaurantModel.findById(user.restaurant);

      if (restaurant) {
        response.restaurantInfo = {
          restaurantId: restaurant._id.toString(), // Garantir que é string
          restaurantName: restaurant.name,
          unitId: user.restaurantUnit?.toString() || null
        };
      }
    }

    console.log('Login response:', response);
    return res.status(200).json(response);
  } catch (error: any) {
    console.error("Erro ao realizar login:", error);
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
    const token = issueJWT(adminUser._id.toString(), email, "ADMIN");

    // Atualizar token de sessão no usuário e no restaurante
    await UserModel.findByIdAndUpdate(adminUser._id, {
      "authentication.sessionToken": token
    });

    await RestaurantModel.findByIdAndUpdate(savedRestaurant._id, {
      "authentication.sessionToken": token
    });

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
    const token = issueJWT(newUser._id.toString(), newUser.email, newUser.role);

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
      restaurantId = req.user.restaurant;

      // Verificar se o gerente é responsável por esta unidade
      if (req.user.restaurantUnit?.toString() !== restaurantUnitId) {
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
// controllers/AuthenticationController.ts
export const validateTokenHandler = async (req: Request, res: Response) => {
  try {
    // Aqui, o middleware já verificou o token
    if (req.isRestaurantAdmin && req.restaurant) {
      const restaurant = req.restaurant;

      // Buscar unidades (simplifique se necessário)
      const units = await RestaurantUnitModel.find({
        _id: { $in: restaurant.units || [] }
      }).select('_id name');

      return res.status(200).json({
        isValid: true,
        user: {
          _id: restaurant._id,
          firstName: restaurant.admin.fullName,
          lastName: "",
          email: restaurant.admin.email,
          role: "ADMIN" // Garantir que retorne "ADMIN" e não "RESTAURANT"
        },
        restaurant: {
          _id: restaurant._id,
          name: restaurant.name
        },
        units: units || []
      });
    } else if (req.user) {
      return res.status(200).json({
        isValid: true,
        role: 'CLIENT',
        user: {
          _id: req.user._id,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          email: req.user.email,
          role: req.user.role,
        }
      });
    } else {
      return res.status(401).json({
        isValid: false,
        message: "Token inválido ou expirado"
      });
    }
  } catch (error: any) {
    console.error("Erro ao validar token:", error);
    return res.status(500).json({
      isValid: false,
      message: "Erro interno do servidor"
    });
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
      await UserModel.findByIdAndUpdate(req.user._id, {
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