import { create } from "zustand";
import { api } from "@/lib/api";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  organizationId: string;
  branchId?: string;
  organization?: { name?: string; timezone?: string };
  branch?: { name?: string; code?: string };
  role?: { name: string; slug: string; permissions: string[] };
  permissions?: string[];
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  login: async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("infatoz_access", data.data.accessToken);
    localStorage.setItem("infatoz_refresh", data.data.refreshToken);
    const payload = data.data.user;
    set({
      user: {
        ...payload,
        id: payload.id ?? payload._id,
        permissions: payload.permissions ?? payload.role?.permissions,
        organization: payload.organization,
        branch: payload.branch
      },
      loading: false
    });
  },
  logout: async () => {
    try {
      await api.post("/auth/logout", { refreshToken: localStorage.getItem("infatoz_refresh") });
    } catch {
      /* ignore */
    }
    localStorage.removeItem("infatoz_access");
    localStorage.removeItem("infatoz_refresh");
    set({ user: null });
  },
  hydrate: async () => {
    if (!localStorage.getItem("infatoz_access")) {
      set({ loading: false, user: null });
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      set({
        user: {
          id: data.data._id,
          name: data.data.name,
          email: data.data.email,
          avatarUrl: data.data.avatarUrl,
          organizationId: data.data.organizationId,
          branchId: data.data.branchId,
          organization: data.data.organization,
          branch: data.data.branch,
          role: data.data.role,
          permissions: data.data.permissions
        },
        loading: false
      });
    } catch {
      set({ loading: false, user: null });
    }
  }
}));
