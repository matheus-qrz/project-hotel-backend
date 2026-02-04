import { Request, Response } from "express";
import {
  deleteHotelUnit,
  getHotelUnitById,
  updateHotelUnit,
  HotelUnitModel,
  getHotelUnitsWithMatrix
} from "../models/HotelUnit";
import { HotelModel, updateHotel } from "../models/Hotel";
import { UserModel } from "../models/User";
import mongoose from "mongoose";

export const addHotelUnitController = async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    const unitData = req.body;

    if (!hotelId) {
      return res.status(400).json({ message: "ID do hotel e obrigatorio" });
    }

    // Verificar se o hotel existe
    const hotel = await HotelModel.findById(hotelId).populate('units');
    if (!hotel) {
      return res.status(404).json({ message: "Hotel nao encontrado" });
    }

    // Verificar se ja existe uma unidade com o mesmo CNPJ
    const existingUnit = await HotelUnitModel.findOne({ cnpj: unitData.cnpj });
    if (existingUnit) {
      return res.status(400).json({ message: "Ja existe uma unidade com este CNPJ" });
    }

    // Criar a unidade com dados completos
    const unit = new HotelUnitModel({
      name: unitData.name,
      socialName: unitData.socialName,
      cnpj: unitData.cnpj,
      phone: unitData.phone,
      address: unitData.address,
      businessHours: unitData.businessHours,
      managers: unitData.managers || [],
      hotel: hotelId,
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
            hotel: hotelId,
            hotelUnit: savedUnit._id
          }
        }
      );
    }

    // Atualizar o hotel com a nova unidade
    hotel.units.push(savedUnit._id);
    await hotel.save();

    // Buscar a unidade populada com os managers para retornar
    const populatedUnit = await HotelUnitModel
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

// Alias para compatibilidade
export const addRestaurantUnitController = addHotelUnitController;

export const getAllHotelUnitsController = async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    const { includeMatrix } = req.query;

    if (!hotelId) {
      return res.status(400).json({ message: "ID do hotel e obrigatorio" });
    }

    // Buscar o hotel com suas unidades e managers populados
    const hotel = await HotelModel
      .findById(hotelId)
      .populate({
        path: 'units',
        populate: {
          path: 'managers',
          select: 'firstName lastName email'
        }
      });

    if (!hotel) {
      return res.status(404).json({ message: "Hotel nao encontrado" });
    }

    // Filtrar unidades baseado no parametro includeMatrix
    let units = hotel.units;
    if (includeMatrix !== 'true') {
      units = units.filter((unit: any) => !unit.isMatrix);
    }

    console.log("Unidades do hotel:", units);

    return res.status(200).json({
      units: units.map((unit: any) => ({
        _id: unit._id,
        name: unit.name,
        managers: unit.managers,
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

// Alias para compatibilidade
export const getAllRestaurantUnitsController = getAllHotelUnitsController;

export const getHotelUnitByIdController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId } = req.params;

    // Verificar se e a matriz (ID do hotel)
    const hotel = await HotelModel.findById(unitId);
    if (hotel) {
      // Retornar dados formatados como unidade matriz
      return res.json({
        _id: hotel._id,
        name: `${hotel.name} (Matriz)`,
        isMatrix: true,
        address: hotel.address,
        cnpj: hotel.cnpj,
        socialName: hotel.socialName,
        manager: hotel.managers || '',
        phone: hotel.phone,
        attendants: [],
        orders: [],
        hotel: hotel._id,
        isActive: true
      });
    }

    // Se nao for matriz, buscar unidade normal
    const hotelUnit = await getHotelUnitById(unitId);
    if (!hotelUnit) {
      return res.status(404).json({ message: "Unidade nao encontrada" });
    }

    res.json(hotelUnit);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao buscar unidade", error });
  }
};

// Alias para compatibilidade
export const getRestaurantUnitByIdController = getHotelUnitByIdController;

export const updateHotelUnitController = async (req: Request, res: Response) => {
  const { unitId } = req.params;
  const updateData = req.body ?? {};

  const unit = await HotelUnitModel.findById(unitId);
  if (!unit) {
    return res.status(404).json({ message: "Unidade nao encontrada" });
  }

  // bloqueia troca de hotel (se seu payload trouxer hotel)
  if (updateData.hotel && String(updateData.hotel) !== String(unit.hotel)) {
    return res.status(400).json({ message: "Nao e permitido alterar o hotel da unidade" });
  }

  // --- Regras especificas de isMatrix ---
  if (typeof updateData.isMatrix !== "undefined") {
    const wantMatrix = !!updateData.isMatrix;

    if (wantMatrix) {
      // Promover esta unidade a matriz (e despromover a anterior, se existir)
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const currentMatrix = await HotelUnitModel.findOne({
            hotel: unit.hotel,
            isMatrix: true,
          }).session(session);

          if (currentMatrix && String(currentMatrix._id) !== String(unit._id)) {
            currentMatrix.isMatrix = false;
            await currentMatrix.save({ session });
          }

          unit.isMatrix = true;
          // aplique tambem outros campos que vierem no update (exceto isMatrix, ja tratado)
          const { isMatrix, hotel, ...rest } = updateData;
          Object.assign(unit, rest);

          await unit.save({ session });
        });
      } finally {
        session.endSession();
      }

      const updated = await HotelUnitModel.findById(unitId);
      return res.status(200).json(updated);
    } else {
      // Despromover esta unidade (so se ja existir outra matriz)
      const anotherMatrixExists = await HotelUnitModel.exists({
        hotel: unit.hotel,
        isMatrix: true,
        _id: { $ne: unit._id },
      });

      if (!anotherMatrixExists) {
        return res.status(400).json({
          message:
            "Esta e a unidade matriz. Promova outra unidade a matriz antes de remove-la.",
        });
      }

      unit.isMatrix = false;
      const { isMatrix, hotel, ...rest } = updateData;
      Object.assign(unit, rest);

      await unit.save();
      const updated = await HotelUnitModel.findById(unitId);
      return res.status(200).json(updated);
    }
  }

  // --- Atualizacao comum (sem mudanca de isMatrix) ---
  const { isMatrix, hotel, ...rest } = updateData;
  Object.assign(unit, rest);

  await unit.save();
  const updated = await HotelUnitModel.findById(unitId);
  return res.status(200).json(updated);
};

// Alias para compatibilidade
export const updateRestaurantUnitController = updateHotelUnitController;


export const deleteHotelUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId, hotelId } = req.params;

    // Verificar se e uma tentativa de deletar a matriz
    const hotel = await HotelModel.findById(unitId);
    if (hotel) {
      return res.status(400).json({
        message: "Nao e permitido deletar a unidade matriz"
      });
    }

    // Verificar se a unidade existe
    const hotelUnit = await getHotelUnitById(unitId);
    if (!hotelUnit) {
      return res.status(404).json({ message: "Unidade nao encontrada" });
    }

    // Excluir a unidade
    const deletedUnit = await deleteHotelUnit(unitId);

    // Remover referencia da unidade no hotel
    if (hotelId) {
      await updateHotel(hotelId, {
        $pull: { units: unitId }
      });
    }

    return res.status(200).json({ message: "Unidade excluida com sucesso", deletedUnit });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao excluir unidade", error });
  }
};

// Alias para compatibilidade
export const deleteRestaurantUnitController = deleteHotelUnitController;

export const addAttendantToUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId } = req.params;
    const { attendantId } = req.body;

    if (!attendantId) {
      return res.status(400).json({ message: "ID do atendente nao fornecido" });
    }

    // Verificar se e uma tentativa de adicionar a matriz
    const hotel = await HotelModel.findById(unitId);
    if (hotel) {
      return res.status(400).json({
        message: "Nao e permitido adicionar atendentes diretamente a matriz"
      });
    }

    // Verificar se a unidade existe
    const hotelUnit = await getHotelUnitById(unitId);
    if (!hotelUnit) {
      return res.status(404).json({ message: "Unidade nao encontrada" });
    }

    // Adicionar atendente a unidade
    await updateHotelUnit(unitId, {
      $addToSet: { attendants: attendantId }
    });

    return res.status(200).json({ message: "Atendente adicionado com sucesso a unidade" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao adicionar atendente a unidade", error });
  }
};

export const removeAttendantFromUnitController = async (
  req: Request,
  res: Response
) => {
  try {
    const { unitId, attendantId } = req.params;

    // Verificar se e uma tentativa de remover da matriz
    const hotel = await HotelModel.findById(unitId);
    if (hotel) {
      return res.status(400).json({
        message: "Nao e permitido remover atendentes da matriz"
      });
    }

    // Verificar se a unidade existe
    const hotelUnit = await getHotelUnitById(unitId);
    if (!hotelUnit) {
      return res.status(404).json({ message: "Unidade nao encontrada" });
    }

    // Remover atendente da unidade
    await updateHotelUnit(unitId, {
      $pull: { attendants: attendantId }
    });

    return res.status(200).json({ message: "Atendente removido com sucesso da unidade" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao remover atendente da unidade", error });
  }
};
