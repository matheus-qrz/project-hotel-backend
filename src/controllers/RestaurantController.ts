import express from "express";
import {
  createRestaurant,
  deleteRestaurant,
  getRestaurantById,
  getRestaurantByName,
  getRestaurants,
  RestaurantModel,
  updateRestaurant,
  getRestaurantByEmail,
  getRestaurantBySlug,
} from "../models/Restaurant";
import { getRestaurantUnitsByRestaurant, RestaurantUnitModel } from "../models/RestaurantUnit";


export const getAllRestaurantsController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const restaurants = await getRestaurants();
    return res.status(200).json(restaurants);
  } catch (error) {
    console.error("Erro ao buscar restaurantes:", error);
    return res.status(500).json({ message: "Erro ao buscar restaurantes", error });
  }
};

export const getRestaurantByIdController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const restaurant = await getRestaurantById(id);

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurante não encontrado" });
    }

    res.json(restaurant);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao buscar restaurante", error });
  }
};

// No controlador
export const getRestaurantBySlugController = async (req: express.Request, res: express.Response) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({ message: "Slug não fornecido" });
    }

    const restaurant = await getRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurante não encontrado" });
    }

    res.json(restaurant);
  } catch (error) {
    console.error('Erro ao buscar restaurante:', error);
    res.status(500).json({ message: "Erro ao buscar restaurante" });
  }
};

export const updateRestaurantController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    // Verificar se é o próprio restaurante que está tentando atualizar
    if (!req.isRestaurantAdmin || !req.restaurant) {
      return res.status(403).json({ message: "Apenas o próprio restaurante pode atualizar seus dados" });
    }

    const { id } = req.params;

    // Verificar se o ID corresponde ao ID do restaurante logado
    if (id !== req.restaurant._id.toString()) {
      return res.status(403).json({ message: "Você só pode atualizar seu próprio restaurante" });
    }

    const { name, cnpj, address, logo, specialty, phone, socialName, rating, admin, units, attendants } = req.body;

    // Verificar se o restaurante existe
    const existingRestaurant = await getRestaurantById(id);
    if (!existingRestaurant) {
      return res.status(404).json({ message: "Restaurante não encontrado" });
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

    // Aplicar a atualização
    const updatedRestaurant = await updateRestaurant(id, updateValues);

    return res.status(200).json(updatedRestaurant || { message: "Restaurante atualizado com sucesso" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao atualizar restaurante", error });
  }
};

export const deleteRestaurantController = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    // Verificar se é o próprio restaurante que está tentando excluir
    if (!req.isRestaurantAdmin || !req.restaurant) {
      return res.status(403).json({ message: "Apenas o próprio restaurante pode excluir sua conta" });
    }

    const { id } = req.params;

    // Verificar se o ID corresponde ao ID do restaurante logado
    if (id !== req.restaurant._id.toString()) {
      return res.status(403).json({ message: "Você só pode excluir seu próprio restaurante" });
    }

    const existingRestaurant = await getRestaurantById(id);
    if (!existingRestaurant) {
      return res.status(404).json({ message: "Restaurante não encontrado" });
    }

    const deletedRestaurant = await deleteRestaurant(id);

    return res.status(200).json({ message: "Restaurante excluído com sucesso", deletedRestaurant });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Erro ao excluir restaurante", error });
  }
};

export const getRestaurantUnitsController = async (req: express.Request, res: express.Response) => {
  try {
    const { restaurantId } = req.params;
    const units = await getRestaurantUnitsByRestaurant(restaurantId);

    if (!units || units.length === 0) {
      return res.status(404).json({ message: "Nenhuma unidade encontrada para este restaurante." });
    }
    res.json(units);
  } catch (error) {
    console.error("Erro ao buscar unidades:", error);
    return res.status(500).json({ message: "Erro ao buscar unidades", error });
  }
};