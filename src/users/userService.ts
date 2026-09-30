import { inject, injectable } from "tsyringe";
import { hashPassword } from "@core/utils/crypto.js";
import { validate } from "@core/validationService.js";
import type { IUser } from "~types/interfaces.js";
import User from "./userModel.js";
import { createUserSchema, emailSchema, usernameSchema, userIdSchema } from "./userSchemas.js";
import { USER_REPOSITORY } from "./infrastructure/tokens.js";
import type { UserRepository } from "./domain/userRepository.js";

@injectable()
export class UserService {
  constructor(@inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async createUser(userData: unknown): Promise<User> {
    const validatedData = validate(userData, createUserSchema);
    const hashedPassword = await hashPassword(validatedData.password);
    const user = await this.userRepository.create({
      ...validatedData,
      password: hashedPassword,
    });

    return new User(user);
  }

  async createGoogleUser(userData: {
    username: string;
    name: string;
    email: string;
    role: string;
    google_id: string;
  }): Promise<User> {
    const randomPassword = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 36).toString(36))
      .join("");
    const hashedPassword = await hashPassword(randomPassword);
    const user = await this.userRepository.create({
      username: userData.username,
      name: userData.name,
      email: userData.email,
      role: userData.role,
      password: hashedPassword,
    });

    return new User(user);
  }

  async getUserByEmail(email: unknown): Promise<User | null> {
    const validatedEmail = validate(email, emailSchema);
    const user = await this.userRepository.findByEmail(validatedEmail);
    return user ? new User(user) : null;
  }

  async getUserByUsername(username: unknown): Promise<User | null> {
    const validatedUsername = validate(username, usernameSchema);
    const user = await this.userRepository.findByUsername(validatedUsername);
    return user ? new User(user) : null;
  }

  async getUserById(id: unknown): Promise<User | null> {
    const validatedId = validate(id, userIdSchema);
    const user = await this.userRepository.findById(validatedId);
    return user ? new User(user) : null;
  }

  async getAllUsers(role: string | null = null): Promise<User[]> {
    const users = await this.userRepository.findAll(role);
    return users.map((user) => new User(user));
  }

  async updateUser(id: unknown, updateData: Partial<IUser>): Promise<User | null> {
    const validatedId = validate(id, userIdSchema);
    const user = await this.userRepository.update(validatedId, updateData);
    return user ? new User(user) : null;
  }

  async deleteUser(id: unknown): Promise<boolean> {
    const validatedId = validate(id, userIdSchema);
    await this.userRepository.delete(validatedId);
    return true;
  }
}
