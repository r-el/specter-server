import { Response } from "express";
import { TypedRequest } from "~types/request.js";
import { IUser } from "~types/interfaces.js";
import { container } from "@core/di.js";
import { catchAsync } from "@core/middlewares/errorHandler.js";
import { AuthService } from "./authService.js";
import { registerSchema, loginSchema, googleLoginSchema, verifyCodeSchema, resendCodeSchema } from "./authSchemas.js";

const authService = () => container.resolve(AuthService);

function formatAuthUser(user: IUser) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

/**
 * Register a new user in the system.
 * @route POST /auth/register
 */
export const register = catchAsync(async (req: TypedRequest<typeof registerSchema>, res: Response) => {
  const { username, password, name, email } = req.body;
  const result = await authService().registerUser(username, password, name, email, "viewer");
  res.status(201).json({
    success: true,
    message: "User registered successfully",
    data: { user: formatAuthUser(result.user), token: result.token },
  });
});

/**
 * Authenticates a user and returns a signed JWT token.
 * @route POST /auth/login
 */
export const login = catchAsync(async (req: TypedRequest<typeof loginSchema>, res: Response) => {
  const { username, password } = req.body;
  const result = await authService().loginUser(username, password);
  res.json({
    success: true,
    message: "Login successful",
    data: { user: formatAuthUser(result.user), token: result.token },
  });
});

/**
 * Authenticates a user via Google OAuth using an ID token.
 * @route POST /auth/google
 */
export const googleLogin = catchAsync(async (req: TypedRequest<typeof googleLoginSchema>, res: Response) => {
  const result = await authService().authenticateViaStrategy("google", { idToken: req.body.idToken });
  res.json({
    success: true,
    message: "Google login successful",
    data: { user: formatAuthUser(result.user), token: result.token },
  });
});

/**
 * Verifies a 6-digit email code.
 * @route POST /auth/verify-code
 */
export const verifyEmailCode = catchAsync(async (req: TypedRequest<typeof verifyCodeSchema>, res: Response) => {
  const result = await authService().verifyCode(req.body.email, req.body.code);
  res.json({
    success: true,
    message: "Email verified successfully",
    data: { user: formatAuthUser(result.user), token: result.token },
  });
});

/**
 * Resends a 6-digit email verification code.
 * @route POST /auth/resend-code
 */
export const resendEmailCode = catchAsync(async (req: TypedRequest<typeof resendCodeSchema>, res: Response) => {
  const result = await authService().resendVerificationCode(req.body.email);
  res.json(result);
});
