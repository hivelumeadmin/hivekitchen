import { create } from 'zustand';
import type { AuthUser } from '@hivekitchen/types';

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearSession: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  updateUser: (partial) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : null,
    })),
  clearSession: () => set({ accessToken: null, user: null }),
  logout: async () => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
    try {
      await fetch(`${apiBase}/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      set({ accessToken: null, user: null });
    }
  },
}));
