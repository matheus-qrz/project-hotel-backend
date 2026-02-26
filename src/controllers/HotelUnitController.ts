import { Request, Response } from "express";
import { HotelUnitModel } from "../models/HotelUnit";
import { HotelModel } from "../models/Hotel";
import QRCode from "qrcode";

/**
 * Adicionar nova unidade ao hotel (Bloco/Ala)
 */
export const addHotelUnitController = async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    const unitData = req.body;

    if (!hotelId) {
      return res.status(400).json({ message: "ID do hotel é obrigatório" });
    }

    // Verificar se o hotel existe
    const hotel = await HotelModel.findById(hotelId).populate('units');
    if (!hotel) {
      return res.status(404).json({ message: "Hotel não encontrado" });
    }

    // Criar a unidade com dados completos
    const unit = new HotelUnitModel({
      name: unitData.name,
      description: unitData.description,
      roomNumberingFormat: unitData.roomNumberingFormat || "SIMPLE",
      rooms: unitData.rooms || [],
      hotel: hotelId
    });

    const savedUnit = await unit.save();

    // Atualizar o hotel com a nova unidade
    hotel.units.push(savedUnit._id as any);
    await hotel.save();

    return res.status(201).json({
      message: "Unidade adicionada com sucesso",
      unit: savedUnit
    });

  } catch (error: any) {
    console.error("Erro ao adicionar unidade:", error);
    return res.status(500).json({
      message: "Erro ao adicionar unidade",
      error: error.message
    });
  }
};

/**
 * Listar todas as unidades de um hotel
 */
export const getAllHotelUnitsController = async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;

    if (!hotelId) {
      return res.status(400).json({ message: "ID do hotel é obrigatório" });
    }

    // Buscar o hotel com suas unidades
    const hotel = await HotelModel
      .findById(hotelId)
      .populate('units');

    if (!hotel) {
      return res.status(404).json({ message: "Hotel não encontrado" });
    }

    return res.status(200).json({
      units: hotel.units
    });
  } catch (error: any) {
    console.error("Erro ao buscar unidades:", error);
    return res.status(500).json({
      message: "Erro ao buscar unidades",
      error: error.message
    });
  }
};

/**
 * Buscar unidade específica por ID
 */
export const getHotelUnitByIdController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;

    const unit = await HotelUnitModel.findById(unitId).populate('hotel', 'name slug');
    
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    return res.status(200).json(unit);
  } catch (error: any) {
    console.error("Erro ao buscar unidade:", error);
    return res.status(500).json({ 
      message: "Erro ao buscar unidade", 
      error: error.message 
    });
  }
};

/**
 * Atualizar dados de uma unidade
 */
export const updateHotelUnitController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const updateData = req.body ?? {};

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    // Bloqueia troca de hotel
    if (updateData.hotel && String(updateData.hotel) !== String(unit.hotel)) {
      return res.status(400).json({ 
        message: "Não é permitido alterar o hotel da unidade" 
      });
    }

    // Atualizar campos permitidos
    const { hotel, rooms, ...rest } = updateData;
    Object.assign(unit, rest);

    await unit.save();
    
    const updated = await HotelUnitModel.findById(unitId);
    return res.status(200).json(updated);
  } catch (error: any) {
    console.error("Erro ao atualizar unidade:", error);
    return res.status(500).json({
      message: "Erro ao atualizar unidade",
      error: error.message
    });
  }
};

/**
 * Deletar uma unidade
 */
export const deleteHotelUnitController = async (req: Request, res: Response) => {
  try {
    const { unitId, hotelId } = req.params;

    // Verificar se a unidade existe
    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    // Verificar se há pedidos associados
    if (unit.orders && unit.orders.length > 0) {
      return res.status(400).json({
        message: "Não é possível deletar unidade com pedidos associados"
      });
    }

    // Excluir a unidade
    await HotelUnitModel.findByIdAndDelete(unitId);

    // Remover referência da unidade no hotel
    if (hotelId) {
      await HotelModel.findByIdAndUpdate(hotelId, {
        $pull: { units: unitId }
      });
    }

    return res.status(200).json({ 
      message: "Unidade excluída com sucesso"
    });
  } catch (error: any) {
    console.error("Erro ao excluir unidade:", error);
    return res.status(500).json({ 
      message: "Erro ao excluir unidade", 
      error: error.message 
    });
  }
};

/**
 * Adicionar quartos a uma unidade
 */
export const addRoomsToUnitController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const { rooms } = req.body;

    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({ 
        message: "Array de quartos é obrigatório" 
      });
    }

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    // Validar se algum roomId já existe
    const existingRoomIds = unit.rooms.map(r => r.roomId);
    const duplicates = rooms.filter(r => existingRoomIds.includes(r.roomId));
    
    if (duplicates.length > 0) {
      return res.status(400).json({
        message: "Alguns quartos já existem nesta unidade",
        duplicates: duplicates.map(d => d.roomId)
      });
    }

    // Adicionar novos quartos
    const newRooms = rooms.map((room: any) => ({
      roomId: room.roomId,
      displayName: room.displayName || `Quarto ${room.roomId}`,
      floor: room.floor,
      sector: room.sector,
      isActive: room.isActive !== undefined ? room.isActive : true,
      qrCode: undefined // Será gerado posteriormente
    }));

    unit.rooms.push(...newRooms);
    await unit.save();

    return res.status(200).json({
      message: `${newRooms.length} quarto(s) adicionado(s) com sucesso`,
      unit
    });
  } catch (error: any) {
    console.error("Erro ao adicionar quartos:", error);
    return res.status(500).json({ 
      message: "Erro ao adicionar quartos", 
      error: error.message 
    });
  }
};

/**
 * Atualizar um quarto específico
 */
export const updateRoomController = async (req: Request, res: Response) => {
  try {
    const { unitId, roomId } = req.params;
    const updateData = req.body;

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const room = unit.rooms.find(r => r.roomId === roomId);
    if (!room) {
      return res.status(404).json({ message: "Quarto não encontrado" });
    }

    // Atualizar campos do quarto
    if (updateData.displayName) room.displayName = updateData.displayName;
    if (updateData.floor !== undefined) room.floor = updateData.floor;
    if (updateData.sector !== undefined) room.sector = updateData.sector;
    if (updateData.isActive !== undefined) room.isActive = updateData.isActive;

    await unit.save();

    return res.status(200).json({
      message: "Quarto atualizado com sucesso",
      room
    });
  } catch (error: any) {
    console.error("Erro ao atualizar quarto:", error);
    return res.status(500).json({ 
      message: "Erro ao atualizar quarto", 
      error: error.message 
    });
  }
};

/**
 * Remover um quarto de uma unidade
 */
export const removeRoomFromUnitController = async (req: Request, res: Response) => {
  try {
    const { unitId, roomId } = req.params;

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const roomIndex = unit.rooms.findIndex(r => r.roomId === roomId);
    if (roomIndex === -1) {
      return res.status(404).json({ message: "Quarto não encontrado" });
    }

    // Remover o quarto
    unit.rooms.splice(roomIndex, 1);
    await unit.save();

    return res.status(200).json({ 
      message: "Quarto removido com sucesso" 
    });
  } catch (error: any) {
    console.error("Erro ao remover quarto:", error);
    return res.status(500).json({ 
      message: "Erro ao remover quarto", 
      error: error.message 
    });
  }
};

/**
 * Listar todos os quartos de uma unidade
 */
export const listUnitRoomsController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const { activeOnly } = req.query;

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    let rooms = unit.rooms;
    
    // Filtrar apenas quartos ativos se solicitado
    if (activeOnly === 'true') {
      rooms = rooms.filter(r => r.isActive);
    }

    return res.status(200).json({
      unitName: unit.name,
      roomNumberingFormat: unit.roomNumberingFormat,
      totalRooms: rooms.length,
      rooms
    });
  } catch (error: any) {
    console.error("Erro ao listar quartos:", error);
    return res.status(500).json({ 
      message: "Erro ao listar quartos", 
      error: error.message 
    });
  }
};

/**
 * Gerar QR Codes para quartos específicos
 */
export const generateRoomQRCodesController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const { roomIds } = req.body;

    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return res.status(400).json({ 
        message: "Array de roomIds é obrigatório" 
      });
    }

    const unit = await HotelUnitModel.findById(unitId).populate('hotel');
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const hotel = unit.hotel as any;
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    
    const qrCodes: Array<{ 
      roomId: string; 
      displayName: string;
      qrCodeUrl: string; 
      qrCodeDataUrl: string 
    }> = [];
    
    for (const roomId of roomIds) {
      const room = unit.rooms.find(r => r.roomId === roomId);
      if (!room) {
        console.warn(`Quarto ${roomId} não encontrado, pulando...`);
        continue;
      }
      
      // URL do QR Code: /[hotelSlug]/room/[roomId]
      const qrUrl = `${baseUrl}/${hotel.slug}/room/${roomId}`;
      
      // Gerar QR Code como Data URL (base64)
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      // Atualizar o quarto com a URL do QR Code
      room.qrCode = qrUrl;
      
      qrCodes.push({
        roomId: room.roomId,
        displayName: room.displayName,
        qrCodeUrl: qrUrl,
        qrCodeDataUrl
      });
    }
    
    await unit.save();
    
    return res.status(200).json({
      message: `${qrCodes.length} QR Code(s) gerado(s) com sucesso`,
      qrCodes
    });
  } catch (error: any) {
    console.error("Erro ao gerar QR Codes:", error);
    return res.status(500).json({ 
      message: "Erro ao gerar QR Codes", 
      error: error.message 
    });
  }
};

/**
 * Gerar QR Codes para TODOS os quartos de uma unidade
 */
export const generateAllRoomQRCodesController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;

    const unit = await HotelUnitModel.findById(unitId).populate('hotel');
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const hotel = unit.hotel as any;
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    
    const qrCodes: Array<{ 
      roomId: string; 
      displayName: string;
      qrCodeUrl: string; 
      qrCodeDataUrl: string 
    }> = [];
    
    for (const room of unit.rooms) {
      // URL do QR Code: /[hotelSlug]/room/[roomId]
      const qrUrl = `${baseUrl}/${hotel.slug}/room/${room.roomId}`;
      
      // Gerar QR Code como Data URL (base64)
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      // Atualizar o quarto com a URL do QR Code
      room.qrCode = qrUrl;
      
      qrCodes.push({
        roomId: room.roomId,
        displayName: room.displayName,
        qrCodeUrl: qrUrl,
        qrCodeDataUrl
      });
    }
    
    await unit.save();
    
    return res.status(200).json({
      message: `${qrCodes.length} QR Code(s) gerado(s) com sucesso`,
      totalRooms: unit.rooms.length,
      qrCodes
    });
  } catch (error: any) {
    console.error("Erro ao gerar QR Codes:", error);
    return res.status(500).json({ 
      message: "Erro ao gerar QR Codes", 
      error: error.message 
    });
  }
};

/**
 * Baixar QR Code de um quarto específico como imagem
 */
export const downloadRoomQRCodeController = async (req: Request, res: Response) => {
  try {
    const { unitId, roomId } = req.params;

    const unit = await HotelUnitModel.findById(unitId).populate('hotel');
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const room = unit.rooms.find(r => r.roomId === roomId);
    if (!room) {
      return res.status(404).json({ message: "Quarto não encontrado" });
    }

    const hotel = unit.hotel as any;
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const qrUrl = `${baseUrl}/${hotel.slug}/room/${roomId}`;

    // Gerar QR Code como Buffer PNG
    const qrCodeBuffer = await QRCode.toBuffer(qrUrl, {
      errorCorrectionLevel: 'M',
      type: 'png',
      width: 500,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Definir headers para download
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="QRCode-${hotel.name}-Quarto-${roomId}.png"`);
    
    return res.send(qrCodeBuffer);
  } catch (error: any) {
    console.error("Erro ao baixar QR Code:", error);
    return res.status(500).json({ 
      message: "Erro ao baixar QR Code", 
      error: error.message 
    });
  }
};

/**
 * Ativar/Desativar um quarto
 */
export const toggleRoomStatusController = async (req: Request, res: Response) => {
  try {
    const { unitId, roomId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ 
        message: "Campo isActive (boolean) é obrigatório" 
      });
    }

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const room = unit.rooms.find(r => r.roomId === roomId);
    if (!room) {
      return res.status(404).json({ message: "Quarto não encontrado" });
    }

    room.isActive = isActive;
    await unit.save();

    return res.status(200).json({
      message: `Quarto ${isActive ? 'ativado' : 'desativado'} com sucesso`,
      room
    });
  } catch (error: any) {
    console.error("Erro ao alterar status do quarto:", error);
    return res.status(500).json({ 
      message: "Erro ao alterar status do quarto", 
      error: error.message 
    });
  }
};

/**
 * Buscar estatísticas de uma unidade
 */
export const getUnitStatisticsController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;

    const unit = await HotelUnitModel.findById(unitId)
      .populate('orders');

    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const totalRooms = unit.rooms.length;
    const activeRooms = unit.rooms.filter(r => r.isActive).length;
    const inactiveRooms = totalRooms - activeRooms;

    const statistics = {
      unitName: unit.name,
      rooms: {
        total: totalRooms,
        active: activeRooms,
        inactive: inactiveRooms
      },
      orders: {
        total: unit.orders.length
      },
      roomNumberingFormat: unit.roomNumberingFormat
    };

    return res.status(200).json(statistics);
  } catch (error: any) {
    console.error("Erro ao buscar estatísticas:", error);
    return res.status(500).json({ 
      message: "Erro ao buscar estatísticas", 
      error: error.message 
    });
  }
};

/**
 * Adicionar múltiplos quartos em lote (bulk)
 */
export const bulkAddRoomsController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const { startNumber, endNumber, prefix, floor, sector } = req.body;

    if (!startNumber || !endNumber) {
      return res.status(400).json({ 
        message: "startNumber e endNumber são obrigatórios" 
      });
    }

    if (endNumber < startNumber) {
      return res.status(400).json({ 
        message: "endNumber deve ser maior ou igual a startNumber" 
      });
    }

    const unit = await HotelUnitModel.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unidade não encontrada" });
    }

    const rooms = [];
    for (let i = startNumber; i <= endNumber; i++) {
      const roomId = prefix ? `${prefix}${i}` : String(i);
      
      // Verificar se já existe
      const exists = unit.rooms.find(r => r.roomId === roomId);
      if (exists) continue;

      rooms.push({
        roomId,
        displayName: `Quarto ${roomId}`,
        floor,
        sector,
        isActive: true,
        qrCode: undefined
      });
    }

    if (rooms.length === 0) {
      return res.status(400).json({
        message: "Todos os quartos já existem nesta unidade"
      });
    }

    unit.rooms.push(...rooms);
    await unit.save();

    return res.status(200).json({
      message: `${rooms.length} quarto(s) adicionado(s) com sucesso`,
      addedRooms: rooms.map(r => r.roomId)
    });
  } catch (error: any) {
    console.error("Erro ao adicionar quartos em lote:", error);
    return res.status(500).json({ 
      message: "Erro ao adicionar quartos em lote", 
      error: error.message 
    });
  }
};