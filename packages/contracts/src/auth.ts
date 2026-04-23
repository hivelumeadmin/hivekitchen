import { z } from "zod";

// POST /v1/auth/login
export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const LoginResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

// POST /v1/auth/refresh
export const RefreshRequest = z.object({
  refreshToken: z.string(),
});

export const RefreshResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
