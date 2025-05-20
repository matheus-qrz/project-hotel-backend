// controllers/EmployeeController.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import { authentication, random } from "../helpers";
import { generateHash, generateSalt } from "../utils/generateSalt";
import { RestaurantModel } from "../models/Restaurant";

// Listar funcionários de todo o restaurante
export const getEmployeesByRestaurantController = async (req: Request, res: Response) => {
    try {
        const { id: restaurantId } = req.params;
        console.log("RestaurantId: ", restaurantId)

        // Verifica se o ID do restaurante é válido
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return res.status(400).json({
                message: "ID de restaurante inválido"
            });
        }

        // Busca todos os funcionários associados ao restaurante
        const employees = await UserModel.find({
            restaurant: restaurantId,
            role: { $in: ["MANAGER", "ATTENDANT"] }
        }).select("firstName lastName avatar restaurantUnit role");

        if (employees.length === 0) {
            return res.status(404).json({
                message: "Nenhum funcionário encontrado para este restaurante"
            });
        }

        return res.status(200).json(employees);
    } catch (error: any) {
        console.error("Erro ao buscar funcionários do restaurante:", error);
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
        const unit = await RestaurantUnitModel.findById(unitId);
        if (!unit) {
            return res.status(404).json({
                message: "Unidade não encontrada"
            });
        }

        // Busca todos os funcionários com função diferente de CLIENT
        const employees = await UserModel.find({
            restaurantUnits: unitId,
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
        }).select("-authentication.password -authentication.salt");

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
        const { firstName, lastName, email, phone, password, role, id: restaurantId, unitId } = req.body;

        // Verifica campos obrigatórios básicos
        if (!firstName || !lastName || !email || !role) {
            return res.status(400).json({
                message: "Nome, sobrenome, email e função são obrigatórios"
            });
        }

        // Verifica se o email já está em uso
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                message: "Email já está em uso"
            });
        }

        // Valida o tipo de função
        const validRoles = ["ADMIN", "MANAGER", "ATTENDANT"];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                message: "Função inválida. Use ADMIN, MANAGER ou ATTENDANT"
            });
        }

        // Verifica se pelo menos um dos IDs (restaurante ou unidade) foi fornecido
        if (!restaurantId && !unitId) {
            return res.status(400).json({
                message: "É necessário fornecer um ID de restaurante ou unidade"
            });
        }

        let restaurant;
        let unit = null;

        // Verifica primeiro o restaurante
        if (restaurantId) {
            if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
                return res.status(400).json({
                    message: "ID de restaurante inválido"
                });
            }
            restaurant = await RestaurantModel.findById(restaurantId);
            if (!restaurant) {
                return res.status(404).json({
                    message: "Restaurante não encontrado"
                });
            }
        }

        // Se houver unitId, verifica a unidade
        if (unitId) {
            if (!mongoose.Types.ObjectId.isValid(unitId)) {
                return res.status(400).json({
                    message: "ID de unidade inválido"
                });
            }
            unit = await RestaurantUnitModel.findById(unitId);
            if (!unit && !restaurant) {
                return res.status(404).json({
                    message: "Unidade não encontrada"
                });
            }
            // Se encontrou a unidade, usa o restaurante associado a ela
            restaurant = await RestaurantModel.findById(unit?.restaurant);
        }

        const salt = generateSalt();
        const hashedPassword = generateHash(password, salt);

        const newEmployee = new UserModel({
            firstName,
            lastName,
            email,
            phone: phone || "",
            role,
            authentication: {
                password: hashedPassword,
                salt,
                sessionToken: "",
            },
            restaurant: restaurant?._id,
            restaurantUnit: unit ? unit._id : restaurant?._id,
            orders: []
        });

        await newEmployee.save();

        // Atualiza as referências apropriadas
        if (unit) {
            await RestaurantUnitModel.findByIdAndUpdate(
                unit._id,
                { $addToSet: { staff: newEmployee._id } }
            );
        }

        await RestaurantModel.findByIdAndUpdate(
            restaurant?._id,
            { $addToSet: { staff: newEmployee._id } }
        );

        return res.status(201).json({
            message: "Funcionário criado com sucesso",
            employee: {
                id: newEmployee._id,
                firstName: newEmployee.firstName,
                lastName: newEmployee.lastName,
                email: newEmployee.email,
                role: newEmployee.role,
                restaurant: restaurant?._id,
                unit: unit ? unit._id : restaurant?._id,
            }
        });
    } catch (error: any) {
        console.error("Erro ao criar funcionário:", error);
        return res.status(500).json({
            message: error.message || "Erro interno no servidor"
        });
    }
};

// Atualizar um funcionário existente
export const updateEmployeeController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, email, phone, role, password } = req.body;

        // Verifica se o ID é válido
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                message: "ID de funcionário inválido"
            });
        }

        // Verifica se o funcionário existe
        const employee = await UserModel.findOne({
            _id: id,
            role: { $ne: "CLIENT" }
        });

        if (!employee) {
            return res.status(404).json({
                message: "Funcionário não encontrado"
            });
        }

        // Verifica se o email está sendo alterado e já existe
        if (email && email !== employee.email) {
            const existingUserWithEmail = await UserModel.findOne({ email });
            if (existingUserWithEmail) {
                return res.status(400).json({
                    message: "Email já está em uso"
                });
            }
        }

        // Prepara os dados para atualização
        const updateData: any = {};
        if (firstName) updateData.firstName = firstName;
        if (lastName) updateData.lastName = lastName;
        if (email) updateData.email = email;
        if (phone) updateData.phone = phone;
        if (role) {
            const validRoles = ["ADMIN", "MANAGER", "ATTENDANT"];
            if (!validRoles.includes(role)) {
                return res.status(400).json({
                    message: "Função inválida. Use ADMIN, MANAGER ou ATTENDANT"
                });
            }
            updateData.role = role;
        }

        // Atualiza a senha se fornecida
        if (password) {
            const salt = random();
            const hashedPassword = authentication(salt, password);
            updateData["authentication.password"] = hashedPassword;
            updateData["authentication.salt"] = salt;
        }

        // Atualiza o funcionário
        const updatedEmployee = await UserModel.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true }
        ).select("-authentication.password -authentication.salt");

        return res.status(200).json(updatedEmployee);
    } catch (error: any) {
        console.error("Erro ao atualizar funcionário:", error);
        return res.status(500).json({
            message: error.message || "Erro interno no servidor"
        });
    }
};

// Excluir um funcionário
export const deleteEmployeeController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verifica se o ID é válido
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                message: "ID de funcionário inválido"
            });
        }

        // Busca o funcionário para verificar se existe e se não é o último ADMIN
        const employee = await UserModel.findOne({
            _id: id,
            role: { $ne: "CLIENT" }
        });

        if (!employee) {
            return res.status(404).json({
                message: "Funcionário não encontrado"
            });
        }

        // Se for um ADMIN, verifica se é o último
        if (employee.role === "ADMIN") {
            const adminsCount = await UserModel.countDocuments({ role: "ADMIN" });
            if (adminsCount <= 1) {
                return res.status(400).json({
                    message: "Não é possível excluir o último administrador"
                });
            }
        }

        // Remove o funcionário das unidades em que ele trabalha
        await RestaurantUnitModel.updateMany(
            { staff: id },
            { $pull: { staff: id } }
        );

        // Exclui o funcionário
        await UserModel.findByIdAndDelete(id);

        return res.status(200).json({
            message: "Funcionário excluído com sucesso"
        });
    } catch (error: any) {
        console.error("Erro ao excluir funcionário:", error);
        return res.status(500).json({
            message: error.message || "Erro interno no servidor"
        });
    }
};