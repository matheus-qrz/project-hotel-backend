import express from "express";
import formidable from 'formidable';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  getUsers,
  getUserById,
  deleteUser,
  getUserByEmail,
  createUser,
  UserModel,
} from "../models/User.ts";
import { authentication, random } from "../helpers/index.ts";
import { RestaurantUnitModel } from "../models/RestaurantUnit.ts";
import { RestaurantModel } from "../models/Restaurant.ts";

const AVATAR_DIR = path.join(process.cwd(), 'public/avatars');

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

export const createUserController = async (
  req: express.Request,
  res: express.Response
) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    const form = formidable({
      uploadDir: AVATAR_DIR,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Erro no upload:', err);
        return res.status(500).json({ msg: 'Erro ao processar o upload' });
      }

      try {
        const email = fields.email?.[0];
        const firstName = fields.firstName?.[0];
        const lastName = fields.lastName?.[0];
        const phone = fields.phone?.[0];
        const password = fields.password?.[0];

        if (!email || !password || !firstName || !phone) {
          return res.status(400).json({ msg: 'Dados obrigatórios não fornecidos' });
        }

        const existingUser = await getUserByEmail(email);

        if (existingUser) {
          return res.status(400).json({ msg: 'Email já cadastrado' });
        }

        let avatarId = null;
        const avatarFile = files.avatar?.[0];

        if (avatarFile) {
          avatarId = uuidv4();
          const fileExt = path.extname(avatarFile.originalFilename || '');
          const newFileName = `${avatarId}${fileExt}`;
          const newPath = path.join(AVATAR_DIR, newFileName);

          fs.renameSync(avatarFile.filepath, newPath);
        }

        const salt = random();
        const user = await createUser({
          firstName,
          lastName,
          email,
          phone,
          authentication: {
            salt,
            password: authentication(salt, password),
          },
          role: "CLIENT",
          avatar: avatarId,
        });

        return res.status(200).json({
          msg: `${user.firstName} account has been created!`,
          avatarUrl: avatarId ? `/avatars/${avatarId}${path.extname(avatarFile?.originalFilename || '')}` : null
        });
      } catch (error) {
        console.error('Erro ao criar usuário:', error);
        return res.status(500).json({ msg: "Could not create user! Please, check data." });
      }
    });
  } else {
    try {
      const { email, firstName, lastName, phone, password, avatar } = req.body;

      if (!email || !password || !firstName || !phone) {
        return res.status(400).json({ msg: 'Missing required fields' });
      }

      const existingUser = await getUserByEmail(email);

      if (existingUser) {
        return res.status(400).json({ msg: 'Email already registered' });
      }

      const salt = random();

      const user = await createUser({
        firstName,
        lastName,
        email,
        phone,
        authentication: {
          salt,
          password: authentication(salt, password),
        },
        role: "CLIENT",
        avatar: avatar || null,
      });

      return res
        .status(200)
        .json({ msg: `${user.firstName} account has been created!` });
    } catch (error) {
      console.log(error);
      return res
        .status(500)
        .json({ msg: "Could not create user! Please, check data." });
    }
  }
};

export const createRestaurantUserController = async (
  req: express.Request,
  res: express.Response
) => {
  // Obter o ID do restaurante dos parâmetros da rota
  const restaurantId = req.params.restaurantId;

  // Verificar se o restaurante existe
  try {
    const restaurant = await RestaurantModel.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ msg: 'Restaurante não encontrado' });
    }
  } catch (error) {
    console.error('Erro ao verificar restaurante:', error);
    return res.status(500).json({ msg: 'Erro ao verificar restaurante' });
  }

  const contentType = req.headers['content-type'] || '';

  // Processamento de formulário com upload de arquivo
  if (contentType.includes('multipart/form-data')) {
    const form = formidable({
      uploadDir: AVATAR_DIR,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Erro no upload:', err);
        return res.status(500).json({ msg: 'Erro ao processar o upload' });
      }

      try {
        // Extrair campos básicos
        const email = fields.email?.[0];
        const firstName = fields.firstName?.[0];
        const lastName = fields.lastName?.[0];
        const phone = fields.phone?.[0];
        const password = fields.password?.[0];
        const restaurantUnitId = fields.restaurantUnitId?.[0];
        const role = fields.role?.[0] || "ATTENDANT"; // Valor padrão se não fornecido

        // Validar role
        if (!["ADMIN", "MANAGER", "ATTENDANT"].includes(role)) {
          return res.status(400).json({
            msg: 'Role inválida. Deve ser ADMIN, MANAGER ou ATTENDANT'
          });
        }

        // Validar campos obrigatórios
        if (!email || !password || !firstName || !phone) {
          return res.status(400).json({ msg: 'Dados obrigatórios não fornecidos' });
        }

        // Verificar se o email já está em uso
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
          return res.status(400).json({ msg: 'Email já cadastrado' });
        }

        // Validar unidade do restaurante, se fornecida
        if (restaurantUnitId) {
          const unit = await RestaurantUnitModel.findById(restaurantUnitId);
          if (!unit) {
            return res.status(404).json({ msg: 'Unidade de restaurante não encontrada' });
          }

          if (unit.restaurant.toString() !== restaurantId.toString()) {
            return res.status(403).json({
              msg: 'Esta unidade não pertence ao seu restaurante'
            });
          }
        }

        // Processar avatar (opcional)
        let avatarId = null;
        const avatarFile = files.avatar?.[0];

        if (avatarFile) {
          avatarId = uuidv4();
          const fileExt = path.extname(avatarFile.originalFilename || '');
          const newFileName = `${avatarId}${fileExt}`;
          const newPath = path.join(AVATAR_DIR, newFileName);

          fs.renameSync(avatarFile.filepath, newPath);
        } else if (avatarFile === undefined && files.avatar) {
          // Limpar arquivo temporário se necessário
          try {
            const tempPath = files.avatar[0]?.filepath;
            if (tempPath && fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch (cleanupError) {
            console.error('Erro ao limpar arquivo temporário:', cleanupError);
          }
        }

        // Criar o usuário
        const salt = random();
        const hashedPassword = authentication(salt, password);

        const user = await createUser({
          firstName,
          lastName,
          email,
          phone,
          authentication: {
            salt, // Armazene o salt
            password: hashedPassword, // Armazene o hashed password
          },
          role,
          avatar: avatarId,
          restaurant: restaurantId,
          restaurantUnit: restaurantUnitId || null,
        });

        // Atualizar relações dependendo da role
        if (role === "MANAGER" && restaurantUnitId) {
          // Se for gerente vinculado a uma unidade, atualizar a unidade
          await RestaurantUnitModel.findByIdAndUpdate(
            restaurantUnitId,
            { manager: `${firstName} ${lastName}` },
            { new: true }
          );
        }

        // Atualizar o restaurante com o novo usuário
        const updateField = role === "MANAGER" ? "managers" : "attendants";
        await RestaurantModel.findByIdAndUpdate(
          restaurantId,
          { $addToSet: { [updateField]: user._id } },
          { new: true }
        );

        // Formatar mensagem baseada na role
        const userType = role === "ADMIN" ? "Administrador" :
          role === "MANAGER" ? "Gerente" : "Atendente";

        return res.status(201).json({
          msg: `${userType} ${user.firstName} criado com sucesso!`,
          user: {
            _id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            restaurantUnit: restaurantUnitId || null
          },
          avatarUrl: avatarId ? `/avatars/${avatarId}${path.extname(avatarFile?.originalFilename || '')}` : null
        });
      } catch (error) {
        console.error('Erro ao criar usuário:', error);
        return res.status(500).json({
          msg: "Erro ao criar usuário. Por favor, verifique os dados."
        });
      }
    });
  } else {
    // Processamento de JSON (sem upload de arquivo)
    try {
      const {
        email,
        firstName,
        lastName,
        phone,
        password,
        restaurantUnitId,
        avatar,
        role = "ATTENDANT" // Valor padrão se não fornecido
      } = req.body;

      // Validar role
      if (!["ADMIN", "MANAGER", "ATTENDANT"].includes(role)) {
        return res.status(400).json({
          msg: 'Role inválida. Deve ser ADMIN, MANAGER ou ATTENDANT'
        });
      }

      // Validar campos obrigatórios
      if (!email || !password || !firstName || !phone) {
        return res.status(400).json({ msg: 'Campos obrigatórios não preenchidos' });
      }

      // Verificar se o email já está em uso
      const existingUser = await getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ msg: 'Email já cadastrado' });
      }

      // Validar unidade do restaurante, se fornecida
      if (restaurantUnitId) {
        const unit = await RestaurantUnitModel.findById(restaurantUnitId);
        if (!unit) {
          return res.status(404).json({ msg: 'Unidade de restaurante não encontrada' });
        }

        if (unit.restaurant.toString() !== restaurantId.toString()) {
          return res.status(403).json({
            msg: 'Esta unidade não pertence ao seu restaurante'
          });
        }
      }

      // Criar o usuário
      const salt = random();
      const user = await createUser({
        firstName,
        lastName,
        email,
        phone,
        authentication: {
          salt,
          password: authentication(salt, password),
        },
        role,
        avatar: avatar || null,
        restaurant: restaurantId,
        restaurantUnit: restaurantUnitId || null,
      });

      // Atualizar relações dependendo da role
      if (role === "MANAGER" && restaurantUnitId) {
        // Se for gerente vinculado a uma unidade, atualizar a unidade
        await RestaurantUnitModel.findByIdAndUpdate(
          restaurantUnitId,
          { manager: `${firstName} ${lastName}` },
          { new: true }
        );
      }

      // Atualizar o restaurante com o novo usuário
      const updateField = role === "MANAGER" ? "managers" : "attendants";
      await RestaurantModel.findByIdAndUpdate(
        restaurantId,
        { $addToSet: { [updateField]: user._id } },
        { new: true }
      );

      // Formatar mensagem baseada na role
      const userType = role === "ADMIN" ? "Administrador" :
        role === "MANAGER" ? "Gerente" : "Atendente";

      return res.status(201).json({
        msg: `${userType} ${user.firstName} criado com sucesso!`,
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          restaurant: restaurantId,
          restaurantUnit: restaurantUnitId || null
        }
      });
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      return res.status(500).json({
        msg: "Erro ao criar usuário. Por favor, verifique os dados."
      });
    }
  }
};

export const getAllUsersController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const users = await getUsers();
    return res.status(200).json(users);
  } catch (error) {
    console.log(error);
    return res.status(400).json({ msg: "Error fetching users" });
  }
};

export const getUserByIdController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;

    const userFound = await UserModel.findById(id);
    if (!userFound) {
      return res.status(404).json({ msg: "User not found" });
    }

    return res.status(200).json({ user: userFound });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const updateUserController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, email, password } = req.body;

    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.phone = phone || user.phone;
    user.email = email || user.email;

    if (password && user.authentication) {
      const salt = random();
      user.authentication.salt = salt;
      user.authentication.password = authentication(salt, password);
    }

    await user.save();
    return res.status(200).json(user);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const deleteUserController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const deletedUser = await deleteUser(id);

    if (!deletedUser) {
      return res.status(404).json({ msg: "User not found" });
    }

    return res.status(200).json(deletedUser);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ msg: "Error deleting user" });
  }
};