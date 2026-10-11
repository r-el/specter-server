/**
 * Authentication Middleware
 * JWT token verification middleware
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ApiError } from "./errorHandler.js";
import { config } from "../config.js";
import { JwtUser } from "~types/request.js";

interface JwtPayload {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "operator" | "viewer";
}

/**
 * Middleware to authenticate JWT token
 * Adds user data to req.user if token is valid
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

    if (!token) throw new ApiError(401, "Access token required");

    const decoded = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;

    (req as Request & { user: JwtUser }).user = {
      id: decoded.id,
      username: decoded.username,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof Error && error.name === "JsonWebTokenError") next(new ApiError(401, "Invalid token"));
    else if (error instanceof Error && error.name === "TokenExpiredError") next(new ApiError(401, "Token expired"));
    else next(error);
  }
}

/**
 * Middleware to check if user has required role
 * Use after authenticateToken middleware
 */
export function requireRole(roles: string | string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: JwtUser }).user;
    if (!user) return next(new ApiError(401, "Authentication required"));

    // Convert single role to array
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(user.role)) return next(new ApiError(403, "Insufficient permissions"));

    next();
  };
}

/**
 * Middleware to check if user can access user resource by ID
 * Users can only access their own resources unless they are admin
 * Use after authenticateToken middleware
 */
export function canAccessUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as Request & { user?: JwtUser }).user;
    if (!user) return next(new ApiError(401, "Authentication required"));

    const targetUserId = req.params.id;

    // Admin can access any user resource
    if (user.role === "admin") return next();

    // Regular users can only access their own resources
    if (user.id !== targetUserId) return next(new ApiError(403, "Forbidden: You can only access your own profile"));

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Enforce role-hierarchy rules for creating/promoting users.
 * admin → can create any role; operator → viewer only.
 * Use after authenticateToken and requireRole middlewares.
 */
export function requireCreationRole(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: JwtUser }).user;
  const targetRole = req.body?.role ?? "viewer";

  if (!user) return next(new ApiError(401, "Authentication required"));

  if (user.role === "admin") return next();

  if (user.role === "operator" && targetRole === "viewer") return next();

  next(new ApiError(403, `${user.role} cannot create ${targetRole} accounts`));
}
