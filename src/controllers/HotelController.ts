import express from "express";
import {
  createHotel,
  deleteHotel,
  getHotelById,
  getHotelByName,
  getHotels,
  HotelModel,
  updateHotel,
  getHotelByEmail,
  getHotelBySlug,
} from "../models/Hotel";
import { getHotelUnitsByHotel, HotelUnitModel } from "../models/HotelUnit";


export const getAllHotelsController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const hotels = await getHotels();
    return res.status(200).json(hotels);
  } catch (error) {
    console.error("Erro ao buscar hoteis:", error);
    return res.status(500).json({ message: "Erro ao buscar hoteis", error });
  }
};

// Alias para compatibilidade
export const getAllRestaurantsController = getAllHotelsController;

export const getHotelByIdController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const hotel = await getHotelById(id);

    if (!hotel) {
      return res.status(404).json({ message: "Hotel nao encontrado" });
    }

    res.json(hotel);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao buscar hotel", error });
  }
};

// Alias para compatibilidade
export const getRestaurantByIdController = getHotelByIdController;

export const getHotelBySlugController = async (req: express.Request, res: express.Response) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({ message: "Slug nao fornecido" });
    }

    const hotel = await getHotelBySlug(slug);

    if (!hotel) {
      return res.status(404).json({ message: "Hotel nao encontrado" });
    }

    res.json(hotel);
  } catch (error) {
    console.error('Erro ao buscar hotel:', error);
    res.status(500).json({ message: "Erro ao buscar hotel" });
  }
};

// Alias para compatibilidade
export const getRestaurantBySlugController = getHotelBySlugController;

export const updateHotelController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    // Verificar se e o proprio hotel que esta tentando atualizar
    if (!req.isHotelAdmin || !req.hotel) {
      return res.status(403).json({ message: "Apenas o proprio hotel pode atualizar seus dados" });
    }

    const { id } = req.params;

    // Verificar se o ID corresponde ao ID do hotel logado
    if (id !== req.hotel._id.toString()) {
      return res.status(403).json({ message: "Voce so pode atualizar seu proprio hotel" });
    }

    const { name, cnpj, address, logo, specialty, phone, socialName, rating, admin, units, attendants } = req.body;

    // Verificar se o hotel existe
    const existingHotel = await getHotelById(id);
    if (!existingHotel) {
      return res.status(404).json({ message: "Hotel nao encontrado" });
    }

    // Criar objeto com valores a serem atualizados
    const updateValues: Record<string, any> = {};

    if (name) updateValues.name = name;
    if (logo) updateValues.logo = logo;
    if (cnpj) updateValues.cnpj = cnpj;
    if (socialName) updateValues.socialName = socialName;
    if (address) updateValues.address = address;
    if (rating !== undefined) updateValues.rating = rating;
    if (specialty) updateValues.specialty = specialty;
    if (phone) updateValues.phone = phone;
    if (admin) updateValues.admin = admin;
    if (units) updateValues.units = units;
    if (attendants) updateValues.attendants = attendants;

    // Aplicar a atualizacao
    const updatedHotel = await updateHotel(id, updateValues);

    return res.status(200).json(updatedHotel || { message: "Hotel atualizado com sucesso" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao atualizar hotel", error });
  }
};

// Alias para compatibilidade
export const updateRestaurantController = updateHotelController;

export const deleteHotelController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    // Verificar se e o proprio hotel que esta tentando excluir
    if (!req.isHotelAdmin || !req.hotel) {
      return res.status(403).json({ message: "Apenas o proprio hotel pode excluir sua conta" });
    }

    const { id } = req.params;

    // Verificar se o ID corresponde ao ID do hotel logado
    if (id !== req.hotel._id.toString()) {
      return res.status(403).json({ message: "Voce so pode excluir seu proprio hotel" });
    }

    const existingHotel = await getHotelById(id);
    if (!existingHotel) {
      return res.status(404).json({ message: "Hotel nao encontrado" });
    }

    const deletedHotel = await deleteHotel(id);

    return res.status(200).json({ message: "Hotel excluido com sucesso", deletedHotel });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao excluir hotel", error });
  }
};

// Alias para compatibilidade
export const deleteRestaurantController = deleteHotelController;

export const getHotelUnitsController = async (req: express.Request, res: express.Response) => {
  try {
    const { hotelId } = req.params;
    const units = await getHotelUnitsByHotel(hotelId);

    if (!units || units.length === 0) {
      return res.status(404).json({ message: "Nenhuma unidade encontrada para este hotel." });
    }
    res.json(units);
  } catch (error) {
    console.error("Erro ao buscar unidades:", error);
    return res.status(500).json({ message: "Erro ao buscar unidades", error });
  }
};

// Alias para compatibilidade
export const getRestaurantUnitsController = getHotelUnitsController;
