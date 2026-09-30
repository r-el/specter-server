import { injectable } from "tsyringe";
import { supabase } from "@core/db/supabase.js";
import type { IUser } from "~types/interfaces.js";
import type { UserRepository } from "../domain/userRepository.js";

@injectable()
export class SupabaseUserRepository implements UserRepository {
  async create(user: IUser): Promise<IUser> {
    const { data, error } = await supabase.from("users").insert(user).select().single();
    if (error) throw new Error(`Database error: ${error.message}`);
    return data;
  }

  findByEmail(email: string): Promise<IUser | null> {
    return this.findOne("email", email);
  }

  findByUsername(username: string): Promise<IUser | null> {
    return this.findOne("username", username);
  }

  findById(id: string): Promise<IUser | null> {
    return this.findOne("id", id);
  }

  async findAll(role: string | null): Promise<IUser[]> {
    let query = supabase.from("users").select("*");
    if (role) query = query.eq("role", role);

    const { data, error } = await query;
    if (error) throw new Error(`Database error: ${error.message}`);
    return data;
  }

  async update(id: string, changes: Partial<IUser>): Promise<IUser | null> {
    const { data, error } = await supabase
      .from("users")
      .update(changes)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) throw new Error(`Database error: ${error.message}`);
  }

  private async findOne(field: "email" | "username" | "id", value: string): Promise<IUser | null> {
    const { data, error } = await supabase.from("users").select("*").eq(field, value).single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }
}
