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
        hotelId: string | null;
        unitId: string | null;
      };
      isHotelAdmin?: boolean;
      identity?: any;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_change_in_production';

// 1) Autenticação base: valida JWT, confere sessionToken no usuário e anexa dados essenciais ao req
export const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token de autenticação não fornecido' });
    }

    const token = authHeader.slice(7).replace(/^"+|"+$/g, '').trim();
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    const user = await UserModel.findById(decoded.sub)
      .select('+authentication.sessionToken +role +hotel +unit');

    if (!user) return res.status(401).json({ message: 'Usuário não encontrado' });
    if (!user.authentication || user.authentication.sessionToken !== token) {
      return res.status(401).json({ message: 'Sessão inválida' });
    }

    req.user = {
      id: user._id.toString(),
      role: user.role || '',
      hotelId: user.hotel?.toString() || null,
      unitId: user.unit?.toString() || null,
    };
    next();
  } catch (err: any) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Sessão expirada'
      : 'Sessão inválida: token inválido';
    return res.status(401).json({ message: msg });
  }
};

// 2) Autorização por hotel (Caminho A):
//    - ADMIN passa direto
//    - MANAGER precisa que user.hotelId === req.params.hotelId
export const authorizeAdminOrManagerForHotel = (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (!role) return res.status(401).json({ message: 'Não autenticado' });

  if (role === 'ADMIN') return next();

  const paramId = String(req.params.hotelId || '');
  const userHotelId = String(req.user?.hotelId || '');

  if (!userHotelId) return res.status(403).json({ message: 'Forbidden' });
  if (userHotelId !== paramId) return res.status(403).json({ message: 'Forbidden' });

  return next();
};

// 3) Guards por papel (sem depender de req.hotel)
export const isHotelAdmin = (req: Request, res: Response, next: NextFunction) => {
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
