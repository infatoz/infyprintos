import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("infatoz_access");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && localStorage.getItem("infatoz_refresh")) {
      original._retry = true;
      try {
        const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh`, {
          refreshToken: localStorage.getItem("infatoz_refresh")
        });
        localStorage.setItem("infatoz_access", data.data.accessToken);
        if (data.data.refreshToken) localStorage.setItem("infatoz_refresh", data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem("infatoz_access");
        localStorage.removeItem("infatoz_refresh");
        if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export const publicApi = axios.create({
  baseURL: import.meta.env.VITE_PUBLIC_URL || ""
});
