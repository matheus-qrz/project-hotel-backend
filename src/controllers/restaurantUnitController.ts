import { Request, Response } from "express";
import {
  deleteRestaurantUnit,
  getRestaurantUnitById,
  updateRestaurantUnit,
  RestaurantUnitModel,
  getRestaurantUnitsWithMatrix
} from "../models/RestaurantUnit.ts";
import { RestaurantModel, updateRestaurant } from "../models/Restaurant.ts";
import { UserModel } from "../models/User.ts";

export const addRestaurantUnitController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params;
    const unitData = req.body;

    if (!restaurantId) {
      return res.status(400).json({ message: "ID do restaurante é obrigatório" });
    }

    // Verificar se o restaurante existe
    const restaurant = await RestaurantModel.findById(restaurantId).populate('units');
    if (!restaurant) {
      return res.status(404).json({ message: "Restaurante não encontrado" });
    }

    // Verificar se já existe uma unidade com o mesmo CNPJ
    const existingUnit = await RestaurantUnitModel.findOne({ cnpj: unitData.cnpj });
    if (existingUnit) {
      return res.status(400).json({ message: "Já existe uma unidade com este CNPJ" });
    }

    // Criar a unidade com dados completos
    const unit = new RestaurantUnitModel({
      name: unitData.name,
      socialName: unitData.socialName,
      cnpj: unitData.cnpj,
      phone: unitData.phone,
      address: unitData.address,
      businessHours: unitData.businessHours,
      managers: unitData.managers || [], // Garantir que managers seja incluído
      restaurant: restaurantId,
      isMatrix: false,
      status: 'active',
      isActive: true
    });

    const savedUnit = await unit.save();

    // Se houver managers, atualizar seus registros para incluir a unidade
    if (unitData.managers && unitData.managers.length > 0) {
      await UserModel.updateMany(
        { _id: { $in: unitData.managers } },
        {
          $set: {
            role: 'MANAGER',
            restaurant: restaurantId,
            restaurantUnit: savedUnit._id
          }
        }
      );
    }

    // Atualizar o restaurante com a nova unidade
    restaurant.units.push(savedUnit._id);
    await restaurant.save();

    // Buscar a unidade populada com os managers para retornar
    const populatedUnit = await RestaurantUnitModel
      .findById(savedUnit._id)
      .populate('managers', 'firstName lastName email');

    return res.status(201).json({
      message: "Unidade adicionada com sucesso",
      unit: populatedUnit
    });

  } catch (error: any) {
    console.error("Erro ao adicionar unidade:", error);
    return res.status(500).json({
      message: "Erro ao adicionar unidade",
      error: error.message
    });
  }
};

// controllers/RestaurantUnitController.ts
export const getAllRestaurantUnitsController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params;
    const { includeMatrix } = req.query;

    if (!restaurantId) {
      return res.status(400).json({ message: "ID do restaurante é obrigatório" });
    }

    // Buscar o restaurante com suas unidades e managers populados
    const restaurant = await RestaurantModel
      .findById(restaurantId)
      .populate({
        path: 'units',
        populate: {
          path: 'managers',
          select: 'firstName lastName email' // Selecionar os campos necessários
        }
      });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurante não encontrado" });
    }

    // Filtrar unidades baseado no parâmetro includeMatrix
    let units = restaurant.units;
    if (includeMatrix !== 'true') {
      units = units.filter((unit: any) => !unit.isMatrix);
    }

    console.log("Unidades do restaurante:", units);

    return res.status(200).json({
      units: units.map((unit: any) => ({
        _id: unit._id,
        name: unit.name,
        managers: unit.managers, // Agora enviando o array completo de managers
        cnpj: unit.cnpj,
        status: unit.status,
        isMatrix: unit.isMatrix,
        isTopSeller: unit.isTopSeller,
        address: unit.address,
        businessHours: unit.businessHours
      }))
    });
  } catch (error: any) {
    console.error("Erro ao buscar unidades:", error);
    return res.status(500).json({
      message: "Erro ao buscar unidades",
      error: error.message
    });
  }
};

export const getRestaurantUnitByIdController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId } = req.params;

    // Verificar se é a matriz (ID do restaurante)
    const restaurant = await RestaurantModel.findById(unitId);
    if (restaurant) {
      // Retornar dados formatados como unidade matriz
      return res.json({
        _id: restaurant._id,
        name: `${restaurant.name} (Matriz)`,
        isMatrix: true,
        address: restaurant.address,
        cnpj: restaurant.cnpj,
        socialName: restaurant.socialName,
        manager: restaurant.managers || '',
        phone: restaurant.phone,
        attendants: [],
        orders: [],
        restaurant: restaurant._id,
        isActive: true
      });
    }

    // Se não for matriz, buscar unidade normal
    const restaurantUnit = await getRestaurantUnitById(unitId);
    if (!restaurantUnit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    res.json(restaurantUnit);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao buscar unidade", error });
  }
};

export const updateRestaurantUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId } = req.params;
    const updateData = req.body;

    // Não permitir alteração do status de matriz
    if ('isMatrix' in updateData) {
      return res.status(400).json({
        message: "Não é permitido alterar o status de matriz de uma unidade"
      });
    }

    // Verificar se é uma unidade matriz
    const unit = await getRestaurantUnitById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    if (unit.isMatrix) {
      return res.status(400).json({
        message: "Não é permitido modificar a unidade matriz diretamente"
      });
    }

    // Criar objeto com valores a serem atualizados
    const updateValues: Record<string, any> = {};
    const allowedFields = ['address', 'cnpj', 'phone', 'manager', 'socialName', 'attendants'];

    for (const field of allowedFields) {
      if (field in updateData) {
        updateValues[field] = updateData[field];
      }
    }

    // Aplicar a atualização
    const updatedUnit = await updateRestaurantUnit(unitId, updateValues);

    return res.status(200).json(updatedUnit || { message: "Unidade atualizada com sucesso" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao atualizar unidade", error });
  }
};

export const deleteRestaurantUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId, restaurantId } = req.params;

    // Verificar se é uma tentativa de deletar a matriz
    const restaurant = await RestaurantModel.findById(unitId);
    if (restaurant) {
      return res.status(400).json({
        message: "Não é permitido deletar a unidade matriz"
      });
    }

    // Verificar se a unidade existe
    const restaurantUnit = await getRestaurantUnitById(unitId);
    if (!restaurantUnit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    // Excluir a unidade
    const deletedUnit = await deleteRestaurantUnit(unitId);

    // Remover referência da unidade no restaurante
    if (restaurantId) {
      await updateRestaurant(restaurantId, {
        $pull: { units: unitId }
      });
    }

    return res.status(200).json({ message: "Unidade excluída com sucesso", deletedUnit });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao excluir unidade", error });
  }
};

export const addAttendantToUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId } = req.params;
    const { attendantId } = req.body;

    if (!attendantId) {
      return res.status(400).json({ message: "ID do atendente não fornecido" });
    }

    // Verificar se é uma tentativa de adicionar à matriz
    const restaurant = await RestaurantModel.findById(unitId);
    if (restaurant) {
      return res.status(400).json({
        message: "Não é permitido adicionar atendentes diretamente à matriz"
      });
    }

    // Verificar se a unidade existe
    const restaurantUnit = await getRestaurantUnitById(unitId);
    if (!restaurantUnit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    // Adicionar atendente à unidade
    await updateRestaurantUnit(unitId, {
      $addToSet: { attendants: attendantId }
    });

    return res.status(200).json({ message: "Atendente adicionado com sucesso à unidade" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao adicionar atendente à unidade", error });
  }
};

export const removeAttendantFromUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId, attendantId } = req.params;

    // Verificar se é uma tentativa de remover da matriz
    const restaurant = await RestaurantModel.findById(unitId);
    if (restaurant) {
      return res.status(400).json({
        message: "Não é permitido remover atendentes da matriz"
      });
    }

    // Verificar se a unidade existe
    const restaurantUnit = await getRestaurantUnitById(unitId);
    if (!restaurantUnit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    // Remover atendente da unidade
    await updateRestaurantUnit(unitId, {
      $pull: { attendants: attendantId }
    });

    return res.status(200).json({ message: "Atendente removido com sucesso da unidade" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao remover atendente da unidade", error });
  }
};


