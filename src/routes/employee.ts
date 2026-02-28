// routes/EmployeeRoutes.ts
import { Router } from "express";
import {
    getEmployeesByUnitController,
    getEmployeeByIdController,
    createEmployeeController,
    updateEmployeeController,
    deleteEmployeeController,
    getEmployeesByHotelController
} from "../controllers/EmployeeController";
import {
    isAuthenticated,
    hasRole,
} from "../middlewares/index";

export default (router: Router) => {
    // Listar todos os funcionários de um hotel (requer ser admin)
    router.get(
        "/hotel/:id/employees",
        isAuthenticated,
        hasRole(['ADMIN', 'MANAGER']),
        getEmployeesByHotelController
    );

    // Listar todos os funcionários de uma unidade (requer ser admin ou gerente)
    router.get(
        "/unit/:unitId/employees",
        isAuthenticated,
        hasRole(['ADMIN', 'MANAGER']),
        getEmployeesByUnitController
    );

    // Obter um funcionário específico por ID (requer ser admin ou gerente)
    router.get(
        "/employee/:id",
        isAuthenticated,
        hasRole(['ADMIN', 'MANAGER']),
        getEmployeeByIdController
    );

    // Criar um novo funcionário (requer ser admin)
    router.post(
        "/hotel/:id/employee/create",
        isAuthenticated,
        hasRole(['ADMIN', 'MANAGER']),
        createEmployeeController
    );

    // Atualizar um funcionário existente (requer ser admin)
    router.patch(
        "/employee/:id/update",
        isAuthenticated,
        hasRole(['ADMIN', 'MANAGER']),
        updateEmployeeController
    );

    // Excluir um funcionário (requer ser admin)
    router.delete(
        "/employee/:id/delete",
        isAuthenticated,
        hasRole(['ADMIN', 'MANAGER']),
        deleteEmployeeController
    );
};