// controllers/EmployeeController.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import { UserModel } from "../models/User";
import { HotelUnitModel } from "../models/HotelUnit";
import { generateHash, generateSalt } from "../utils/generateSalt";
import { HotelModel } from "../models/Hotel";

// Listar funcionários de todo o hotel
export const getEmployeesByHotelController = async (req: Request, res: Response) => {
    try {
        const { id: hotelId } = req.params;
        console.log("HotelId: ", hotelId)

        // Verifica se o ID do hotel é válido
        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({
                message: "ID de hotel inválido"
            });
        }

        // Busca todos os funcionários associados ao hotel
        const employees = await UserModel.find({
            hotel: hotelId,
        }).select("firstName lastName avatar unit role email createdAt");

        if (employees.length === 0) {
            return res.status(404).json({
                message: "Nenhum funcionário encontrado para este hotel"
            });
        }

        return res.status(200).json(employees);
    } catch (error: any) {
        console.error("Erro ao buscar funcionários do hotel:", error);
        return res.status(500).json({
            message: error.message || "Erro interno no servidor"
        });
    }
};

// Listar funcionários de uma unidade específica
export const getEmployeesByUnitController = async (req: Request, res: Response) => {
    try {
        const { unitId } = req.params;

        // Verifica se o ID da unidade é válido
        if (!mongoose.Types.ObjectId.isValid(unitId)) {
            return res.status(400).json({
                message: "ID de unidade inválido"
            });
        }

        // Verifica se a unidade existe
        const unit = await HotelUnitModel.findById(unitId);
        if (!unit) {
            return res.status(404).json({
                message: "Unidade não encontrada"
            });
        }

        // Busca todos os funcionários com função diferente de CLIENT
        const employees = await UserModel.find({
            unit: unitId,
            role: { $ne: "CLIENT" }
        }).select("-authentication.password -authentication.salt");

        return res.status(200).json(employees);
    } catch (error: any) {
        console.error("Erro ao buscar funcionários:", error);
        return res.status(500).json({
            message: error.message || "Erro interno no servidor"
        });
    }
};

// Obter detalhes de um funcionário específico
export const getEmployeeByIdController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verifica se o ID é válido
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                message: "ID de funcionário inválido"
            });
        }

        // Busca o funcionário
        const employee = await UserModel.findOne({
            _id: id,
            role: { $ne: "CLIENT" }
        }).select("-authentication.password -authentication.salt")
            .populate('hotel')
            .populate('unit');

        if (!employee) {
            return res.status(404).json({
                message: "Funcionário não encontrado"
            });
        }

        return res.status(200).json(employee);
    } catch (error: any) {
        console.error("Erro ao buscar funcionário:", error);
        return res.status(500).json({
            message: error.message || "Erro interno no servidor"
        });
    }
};

// Criar um novo funcionário
export const createEmployeeController = async (req: Request, res: Response) => {
  try {
    let {
      firstName,
      lastName,
      email,
      cpf,
      phone,
      password,
      role,
      hotel,
      unit, 
      unitId,
    } = req.body as any;

    email = email ? String(email).trim().toLowerCase() : undefined;
    cpf = cpf ? String(cpf).replace(/\D/g, "") : undefined;
    phone = phone ? String(phone).trim() : "";

    const validRoles = ["ADMIN", "MANAGER", "ATTENDANT"] as const;
    role = (role || "ATTENDANT").toUpperCase();
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Função inválida. Use ADMIN, MANAGER ou ATTENDANT" });
    }

    // obrigatórios comuns
    if (!firstName || !lastName) {
      return res.status(400).json({ message: "Nome e sobrenome são obrigatórios" });
    }

    // hotel obrigatório e válido
    if (!hotel) {
      return res.status(400).json({ message: "O ID do hotel é obrigatório" });
    }
    if (!mongoose.Types.ObjectId.isValid(hotel)) {
      return res.status(400).json({ message: "ID de hotel inválido" });
    }

    const hotelDoc = await HotelModel.findById(hotel);
    if (!hotelDoc) {
      return res.status(404).json({ message: "Hotel não encontrado" });
    }

    // normaliza campo de unidade (aceita unitId também)
    unit = unit || unitId || null;

    // Regras por função
    if (role === "ADMIN" || role === "MANAGER") {
      if (!cpf) return res.status(400).json({ message: "CPF é obrigatório para ADMIN/MANAGER" });
      if (!email) return res.status(400).json({ message: "Email é obrigatório para ADMIN/MANAGER" });
      if (!password) return res.status(400).json({ message: "Senha é obrigatória para ADMIN/MANAGER" });
    }

    if (role === "ATTENDANT") {
      if (!cpf) return res.status(400).json({ message: "CPF é obrigatório para ATTENDANT" });
    }

    // validar unidade (quando vier uma unit de fato)
    let unitDoc: any = null;
    let isMatrixSelection = false;

    if (!hotel || !mongoose.Types.ObjectId.isValid(hotel)) {
      return res.status(400).json({ message: "ID de hotel inválido/ausente" });
    }
    if (!hotelDoc) {
      return res.status(404).json({ message: "Hotel não encontrado" });
    }

    if (unit) {
      if (String(unit) === String(hotelDoc._id)) {
        // Usuário escolheu "Matriz" (front costuma enviar o próprio hotelId)
        isMatrixSelection = true;
      } else {
        if (!mongoose.Types.ObjectId.isValid(unit)) {
          return res.status(400).json({ message: "ID de unidade inválido" });
        }
        unitDoc = await HotelUnitModel.findById(unit);
        if (!unitDoc) return res.status(404).json({ message: "Unidade não encontrada" });
        if (String(unitDoc.hotel) !== String(hotelDoc._id)) {
          return res.status(400).json({ message: "Esta unidade não pertence ao hotel informado" });
        }
      }
    }

    if (cpf) {
      const cpfExists = await UserModel.findOne({ cpf });
      if (cpfExists) return res.status(409).json({ message: "Já existe um usuário com este CPF" });
    }
    if (email) {
      const emailExists = await UserModel.findOne({ email });
      if (emailExists) return res.status(409).json({ message: "Já existe um usuário com este email" });
    }

    let authentication: any = undefined;

    if (
      role === "ADMIN" ||
      role === "MANAGER" ||
      (role === "ATTENDANT" && password)
    ) {
      const salt = generateSalt();
      const hashedPassword = generateHash(password, salt);
      authentication = { password: hashedPassword, salt, sessionToken: "" };
    }

    // monta doc do usuário
    const newEmployee = new UserModel({
      firstName,
      lastName,
      email,                 
      cpf,                  
      phone: phone || "",
      role,
      authentication,        
      hotel: hotelDoc._id,
      unit: unitDoc ? unitDoc._id : (isMatrixSelection ? null : null),
      orders: [],
    });

    await newEmployee.save();

    if (unitDoc) {
    if (role === "MANAGER") {
      await HotelUnitModel.findByIdAndUpdate(
        unitDoc._id,
        { $addToSet: { managers: newEmployee._id } }
      );
    } else if (role === "ATTENDANT") {
      await HotelUnitModel.findByIdAndUpdate(
        unitDoc._id,
        { $addToSet: { attendants: newEmployee._id } }
      );
    }
    }

    const hotelUpdate: any = {};
    if (role === "MANAGER") hotelUpdate.$addToSet = { ...(hotelUpdate.$addToSet||{}), managers: newEmployee._id };
    if (role === "ATTENDANT") hotelUpdate.$addToSet = { ...(hotelUpdate.$addToSet||{}), attendants: newEmployee._id };
    if (Object.keys(hotelUpdate).length) {
      await HotelModel.findByIdAndUpdate(hotelDoc._id, hotelUpdate);
    }

    return res.status(201).json({
      message: "Funcionário criado com sucesso",
      employee: {
        id: newEmployee._id,
        firstName: newEmployee.firstName,
        lastName: newEmployee.lastName,
        email: newEmployee.email,
        role: newEmployee.role,
        hotel: newEmployee.hotel,
        unit: newEmployee.unit, 
      },
    });
  } catch (error: any) {
    console.error("Erro ao criar funcionário:", error);

    // respostas mais claras
    if (error?.name === "ValidationError") {
      const first = Object.values(error.errors || {})[0] as any;
      return res.status(400).json({ message: first?.message || "Erro de validação", path: first?.path });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Duplicado", dup: error.keyValue });
    }

    return res.status(500).json({ message: error.message || "Erro interno no servidor" });
  }
};

// Atualizar um funcionário existente
export const updateEmployeeController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            firstName,
            lastName,
            email,
            phone,
            password,
            role,
            hotel,
            unit
        } = req.body;

        // Verifica se o funcionário existe
        const employee = await UserModel.findById(id);
        if (!employee) {
            return res.status(404).json({ message: "Funcionário não encontrado" });
        }

        // Valida papel
        const validRoles = ["ADMIN", "MANAGER", "ATTENDANT"];
        if (role && !validRoles.includes(role)) {
            return res.status(400).json({ message: "Função inválida" });
        }

        // Valida hotel (se enviado)
        let hotelDoc = employee.hotel;
        if (hotel && hotel !== String(employee.hotel)) {
            if (!mongoose.Types.ObjectId.isValid(hotel)) {
                return res.status(400).json({ message: "ID de hotel inválido" });
            }
            const h = await HotelModel.findById(hotel);
            if (!h) return res.status(404).json({ message: "Hotel não encontrado" });
            hotelDoc = h._id;
        }

        // Valida unidade (se enviada)
        let unitDoc = employee.unit;
        if (unit && unit !== String(employee.unit)) {
            if (!mongoose.Types.ObjectId.isValid(unit)) {
                return res.status(400).json({ message: "ID de unidade inválido" });
            }
            const u = await HotelUnitModel.findById(unit);
            if (!u) {
                return res.status(404).json({ message: "Unidade não encontrada" });
            }
            if (String(u.hotel) !== String(hotelDoc)) {
                return res.status(400).json({ message: "Unidade não pertence ao hotel fornecido" });
            }
            unitDoc = u._id;
        }

        // Atualiza dados básicos
        if (firstName) employee.firstName = firstName;
        if (lastName) employee.lastName = lastName;
        if (email) employee.email = email;
        if (phone) employee.phone = phone;
        if (role) employee.role = role;

        // Atualiza senha se fornecida
        if (password && password.length >= 6) {
            const salt = generateSalt();
            const hashedPassword = generateHash(password, salt);
            employee.authentication && employee.authentication.password === hashedPassword;
            employee.authentication && employee.authentication.salt === salt;
        }

        // Atualiza vínculos
        employee.hotel = hotelDoc;
        employee.unit = unitDoc;

        await employee.save();

        return res.status(200).json({
            message: "Funcionário atualizado com sucesso",
            employee: {
                id: employee._id,
                firstName: employee.firstName,
                lastName: employee.lastName,
                email: employee.email,
                role: employee.role,
                hotel: employee.hotel,
                unit: employee.unit
            }
        });
    } catch (error: any) {
        console.error("Erro ao atualizar funcionário:", error);
        return res.status(500).json({ message: error.message || "Erro interno do servidor" });
    }
};

// Excluir um funcionário
export const deleteEmployeeController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const employee = await UserModel.findById(id);
        if (!employee) {
            return res.status(404).json({ message: "Funcionário não encontrado" });
        }

        // Remove o vínculo do funcionário da unidade, se existir
        if (employee.unit) {
            await HotelUnitModel.findByIdAndUpdate(
                employee.unit,
                { $pull: { staff: employee._id } }
            );
        }

        // Remove o vínculo do funcionário do hotel (matriz)
        if (employee.hotel) {
            await HotelModel.findByIdAndUpdate(
                employee.hotel,
                { $pull: { staff: employee._id } }
            );
        }

        if (employee.unit) {
          if (employee.role === "MANAGER") {
            await HotelUnitModel.findByIdAndUpdate(
              employee.unit,
              { $pull: { managers: employee._id } }
            );
          } else if (employee.role === "ATTENDANT") {
            await HotelUnitModel.findByIdAndUpdate(
              employee.unit,
              { $pull: { attendants: employee._id } }
            );
          }
        }


        if (employee.hotel) {
          if (employee.role === "MANAGER") {
            await HotelModel.findByIdAndUpdate(
              employee.hotel,
              { $pull: { managers: employee._id } }
            );
          } else if (employee.role === "ATTENDANT") {
            await HotelModel.findByIdAndUpdate(
              employee.hotel,
              { $pull: { attendants: employee._id } }
            );
          }
        }

        // Deleta o funcionário
        await UserModel.findByIdAndDelete(id);

        return res.status(200).json({ message: "Funcionário removido com sucesso" });
    } catch (error: any) {
        console.error("Erro ao remover funcionário:", error);
        return res.status(500).json({ message: error.message || "Erro interno do servidor" });
    }
};
