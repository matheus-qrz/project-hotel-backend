// controllers/EmployeeController.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
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
        }).select("-authentication.password -authentication.salt")
            .populate('restaurant')
            .populate('restaurantUnit');

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
        const {
            firstName,
            lastName,
            email,
            phone,
            password,
            role,
            restaurant,
            restaurantUnit
        } = req.body;

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

        // Verifica se o ID de restaurante foi fornecido
        if (!restaurant) {
            return res.status(400).json({
                message: "O ID do restaurante é obrigatório"
            });
        }

        // Validação do ID do restaurante
        if (!mongoose.Types.ObjectId.isValid(restaurant)) {
            return res.status(400).json({
                message: "ID de restaurante inválido"
            });
        }

        let restaurantDoc = await RestaurantModel.findById(restaurant);
        if (!restaurantDoc) {
            return res.status(404).json({
                message: "Restaurante não encontrado"
            });
        }

        let unitDoc = null;

        // Se houver unidade, validar também
        if (restaurantUnit) {
            if (!mongoose.Types.ObjectId.isValid(restaurantUnit)) {
                return res.status(400).json({
                    message: "ID de unidade inválido"
                });
            }

            unitDoc = await RestaurantUnitModel.findById(restaurantUnit);
            if (!unitDoc) {
                return res.status(404).json({
                    message: "Unidade não encontrada"
                });
            }

            // Garante que a unidade pertença ao restaurante informado
            if (unitDoc.restaurant.toString() !== restaurant) {
                return res.status(400).json({
                    message: "Esta unidade não pertence ao restaurante informado"
                });
            }
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
            restaurant: restaurantDoc._id,
            restaurantUnit: unitDoc ? unitDoc._id : restaurantDoc._id,
            orders: []
        });

        await newEmployee.save();

        // Atualiza as referências apropriadas
        if (unitDoc) {
            await RestaurantUnitModel.findByIdAndUpdate(
                unitDoc._id,
                { $addToSet: { staff: newEmployee._id } }
            );
        }

        await RestaurantModel.findByIdAndUpdate(
            restaurantDoc._id,
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
                restaurant: newEmployee.restaurant,
                restaurantUnit: newEmployee.restaurantUnit,
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
        const {
            firstName,
            lastName,
            email,
            phone,
            password,
            role,
            restaurant,
            restaurantUnit
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

        // Valida restaurant (se enviado)
        let restaurantDoc = employee.restaurant;
        if (restaurant && restaurant !== String(employee.restaurant)) {
            if (!mongoose.Types.ObjectId.isValid(restaurant)) {
                return res.status(400).json({ message: "ID de restaurante inválido" });
            }
            const r = await RestaurantModel.findById(restaurant);
            if (!r) return res.status(404).json({ message: "Restaurante não encontrado" });
            restaurantDoc = r._id;
        }

        // Valida unidade (se enviada)
        let unitDoc = employee.restaurantUnit;
        if (restaurantUnit && restaurantUnit !== String(employee.restaurantUnit)) {
            if (!mongoose.Types.ObjectId.isValid(restaurantUnit)) {
                return res.status(400).json({ message: "ID de unidade inválido" });
            }
            const unit = await RestaurantUnitModel.findById(restaurantUnit);
            if (!unit) {
                return res.status(404).json({ message: "Unidade não encontrada" });
            }
            if (String(unit.restaurant) !== String(restaurantDoc)) {
                return res.status(400).json({ message: "Unidade não pertence ao restaurante fornecido" });
            }
            unitDoc = unit._id;
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
        employee.restaurant = restaurantDoc;
        employee.restaurantUnit = unitDoc;

        await employee.save();

        return res.status(200).json({
            message: "Funcionário atualizado com sucesso",
            employee: {
                id: employee._id,
                firstName: employee.firstName,
                lastName: employee.lastName,
                email: employee.email,
                role: employee.role,
                restaurant: employee.restaurant,
                restaurantUnit: employee.restaurantUnit
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
        if (employee.restaurantUnit) {
            await RestaurantUnitModel.findByIdAndUpdate(
                employee.restaurantUnit,
                { $pull: { staff: employee._id } }
            );
        }

        // Remove o vínculo do funcionário do restaurante (matriz)
        if (employee.restaurant) {
            await RestaurantModel.findByIdAndUpdate(
                employee.restaurant,
                { $pull: { staff: employee._id } }
            );
        }

        // Deleta o funcionário
        await UserModel.findByIdAndDelete(id);

        return res.status(200).json({ message: "Funcionário removido com sucesso" });
    } catch (error: any) {
        console.error("Erro ao remover funcionário:", error);
        return res.status(500).json({ message: error.message || "Erro interno do servidor" });
    }
};
