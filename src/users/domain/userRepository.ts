import type { IUser } from "~types/interfaces.js";

export interface UserRepository {
  create(user: IUser): Promise<IUser>;
  findByEmail(email: string): Promise<IUser | null>;
  findByUsername(username: string): Promise<IUser | null>;
  findById(id: string): Promise<IUser | null>;
  findAll(role: string | null): Promise<IUser[]>;
  update(id: string, changes: Partial<IUser>): Promise<IUser | null>;
  delete(id: string): Promise<void>;
}
