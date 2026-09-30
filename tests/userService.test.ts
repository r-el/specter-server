import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@core/utils/crypto.js";
import type { UserRepository } from "@users/domain/userRepository.js";
import { UserService } from "@users/userService.js";

vi.mock("@core/utils/crypto.js", () => ({ hashPassword: vi.fn() }));

describe("UserService", () => {
  const repository: UserRepository = {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const service = new UserService(repository);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates and hashes passwords before creating a user", async () => {
    vi.mocked(hashPassword).mockResolvedValue("hashed-password");
    vi.mocked(repository.create).mockResolvedValue({
      id: "user-id",
      username: "operator",
      password: "hashed-password",
      name: "Operator",
      email: "operator@example.com",
      role: "viewer",
    });

    const user = await service.createUser({
      username: "operator",
      password: "password123",
      name: "Operator",
      email: "operator@example.com",
    });

    expect(hashPassword).toHaveBeenCalledWith("password123");
    expect(repository.create).toHaveBeenCalledWith({
      username: "operator",
      password: "hashed-password",
      name: "Operator",
      email: "operator@example.com",
      role: "viewer",
    });
    expect(user.password).toBe("hashed-password");
  });

  it("validates lookup input and returns null when the user does not exist", async () => {
    vi.mocked(repository.findByUsername).mockResolvedValue(null);

    await expect(service.getUserByUsername("valid_user")).resolves.toBeNull();
    expect(repository.findByUsername).toHaveBeenCalledWith("valid_user");
  });

  it("validates IDs before updating a user", async () => {
    vi.mocked(repository.update).mockResolvedValue(null);

    await expect(service.updateUser("not-a-uuid", { name: "Updated" })).rejects.toThrow();
    expect(repository.update).not.toHaveBeenCalled();
  });
});
