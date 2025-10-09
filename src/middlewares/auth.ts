// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/User';

interface JwtPayload {
  sub: string;      // ID do usuário
  email?: string;
  role?: string;
  iat: number;
  exp: number;
}

// Tipos anexados à requisição
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        restaurantId: string | null;
        unitId: string | null;
      };
      isRestaurantAdmin?: boolean;
      identity?: any;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_change_in_production';

// 1) Autenticação base: valida JWT, confere sessionToken no usuário e anexa dados essenciais ao req

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = req.headers.authorization || ''
    const raw = auth.startsWith('Bearer ') ? auth.slice(7) : auth
    const headerToken = raw?.replace(/^"+|"+$/g, '').trim()
    const cookieToken = (req as any).cookies?.token // se usar cookie-parser
    const token = headerToken || cookieToken

    if (!token) {
      return res.status(401).json({ message: 'Sessão inválida: token ausente.' })
    }

    const payload = jwt.verify(token, JWT_SECRET) as any

    req.user = {
      id: payload.sub,
      role: payload.role,
      restaurantId: payload.restaurantId,
      unitId: payload.unitId,
    }

    return next()
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Sessão expirada.' })
    }
    return res.status(401).json({ message: 'Sessão inválida: token inválido.' })
  }
}

// 2) Autorização por restaurante (Caminho A):
//    - ADMIN passa direto
//    - MANAGER precisa que user.restaurantId === req.params.restaurantId
export const authorizeAdminOrManagerForRestaurant = (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (!role) return res.status(401).json({ message: 'Não autenticado' });

  if (role === 'ADMIN') return next();

  const paramId = String(req.params.restaurantId || '');
  const userRestaurantId = String(req.user?.restaurantId || '');

  if (!userRestaurantId) return res.status(403).json({ message: 'Forbidden' });
  if (userRestaurantId !== paramId) return res.status(403).json({ message: 'Forbidden' });

  return next();
};

// 3) Guards por papel (sem depender de req.restaurant)
export const isRestaurantAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role === 'ADMIN') return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores têm permissão.' });
};

export const isManager = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && (req.user.role === 'ADMIN' || req.user.role === 'MANAGER')) return next();
  return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
};

export const isAttendantOrAbove = (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (role && ['ADMIN', 'MANAGER', 'ATTENDANT'].includes(role)) return next();
  return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
};
