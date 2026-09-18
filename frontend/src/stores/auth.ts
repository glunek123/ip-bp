import { defineStore } from 'pinia';
import { ApiError, setCsrfToken } from '../api/http';
import {
  getSession,
  login as loginRequest,
  logout as logoutRequest,
  type AuthSession,
} from '../api/auth';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null as AuthSession | null,
    restored: false,
  }),
  actions: {
    async restore(): Promise<void> {
      if (this.restored) return;
      try {
        this.session = await getSession();
        this.restored = true;
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 401 ||
          error.code !== 'UNAUTHORIZED'
        )
          throw error;
        this.session = null;
        this.restored = true;
        setCsrfToken(null);
      }
    },
    async login(
      username: string,
      password: string,
      departmentId?: string,
    ): Promise<void> {
      this.session = await loginRequest(username, password, departmentId);
      this.restored = true;
    },
    async logout(): Promise<void> {
      await logoutRequest();
      this.session = null;
      this.restored = true;
      setCsrfToken(null);
    },
    clear(): void {
      this.session = null;
      this.restored = true;
      setCsrfToken(null);
    },
  },
});
