// hasRole.ts
import { Request, Response, NextFunction } from "express";

type UserRole = 'ADMIN' | 'MANAGER' | 'ATTENDANT' | 'CLIENT';

export const hasRole = (required: UserRole | UserRole[]) => {
  const requiredRoles = Array.isArray(required) ? required : [required];

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1) pega do req.user (preferido), fallback para req.identity
      const role: UserRole | undefined =
        (req.user?.role as UserRole | undefined) ||
        ((req as any).identity?.role as UserRole | undefined);

      // 401 quando não há usuário/role
      if (!role) {
        return res.status(401).json({ message: "Acesso negado: não autenticado" });
      }

      // 403 quando não possui uma das roles necessárias
      if (!requiredRoles.includes(role)) {
        return res.status(403).json({
          message: "Acesso negado: permissões insuficientes",
          required: requiredRoles,
          current: role,
        });
      }

      return next();
    } catch (err) {
      console.error("Erro na verificação de roles:", err);
      return res.status(500).json({ message: "Erro interno ao verificar permissões" });
    }
  };
};
