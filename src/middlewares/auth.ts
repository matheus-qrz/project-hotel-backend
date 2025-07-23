// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/User';
import { RestaurantModel } from '../models/Restaurant';

interface JwtPayload {
    sub: string;      // ID do usuário ou restaurante
    email: string;    // Email
    role: string;     // Role (ADMIN, MANAGER, etc.)
    iat: number;      // Issued at
    exp: number;      // Expiration
}


// Adicionar type declarations para incluir o usuário/restaurante nas requisições
declare global {
    namespace Express {
        interface Request {
            user?: any;
            restaurant?: any;
            isRestaurantAdmin?: boolean;
        }
    }
}

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_in_production";

export const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ message: 'Token de autenticação não fornecido' });
        }

        const token = authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"
        console.log('Token recebido:', token); // Log do token

        // Verificar token JWT
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
        console.log('Token decodificado:', decoded); // Log do token decodificado

        // Verificação de restaurante
        const restaurant = await RestaurantModel.findById(decoded.sub).select('+authentication.sessionToken');
        if (restaurant) {
            if (!restaurant.authentication || restaurant.authentication.sessionToken !== token) {
                return res.status(401).json({ message: 'Sessão inválida' });
            }

            req.restaurant = restaurant;
            req.isRestaurantAdmin = true;
            req.identity = restaurant; // Definindo identity
            return next();
        }

        // Verificação de usuário admin
        const adminUser = await UserModel.findOne({
            _id: decoded.sub,
            role: 'ADMIN'
        }).select('+authentication.sessionToken');

        if (adminUser) {
            if (!adminUser.authentication || adminUser.authentication.sessionToken !== token) {
                return res.status(401).json({ message: 'Sessão inválida' });
            }

            req.user = adminUser;
            req.isRestaurantAdmin = true;
            req.identity = adminUser; // Definindo identity
            return next();
        }

        // Verificação de usuário normal
        const user = await UserModel.findById(decoded.sub).select('+authentication.sessionToken');
        if (!user) {
            return res.status(401).json({ message: 'Usuário não encontrado' });
        }

        if (!user.authentication) {
            return res.status(401).json({ message: 'Sessão inválida' });
        }

        req.user = user;
        req.isRestaurantAdmin = false;
        req.identity = user; // Definindo identity
        return next();

    } catch (error) {
        console.error('Erro de autenticação:', error);
        res.status(401).json({ message: 'Token inválido ou expirado' });
    }
};

// Middleware para verificar se é admin do restaurante
export const isRestaurantAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.isRestaurantAdmin && req.restaurant) {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Apenas administradores de restaurante têm permissão.' });
    }
};

// Middleware para verificar se o usuário é um gerente
export const isManager = (req: Request, res: Response, next: NextFunction) => {
    if (req.isRestaurantAdmin || (req.user && req.user.role === 'MANAGER')) {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
    }
};

// Middleware para verificar se é um atendente ou superior
export const isAttendantOrAbove = (req: Request, res: Response, next: NextFunction) => {
    if (
        req.isRestaurantAdmin ||
        (req.user && ['ADMIN', 'MANAGER', 'ATTENDANT'].includes(req.user.role))
    ) {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
    }
};