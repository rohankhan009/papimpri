import axios from "axios";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const t = localStorage.getItem("lb_token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export const getToken = () => localStorage.getItem("lb_token");
export const setAuth = (token, role, username) => {
  localStorage.setItem("lb_token", token);
  localStorage.setItem("lb_role", role);
  localStorage.setItem("lb_username", username);
};
export const clearAuth = () => {
  localStorage.removeItem("lb_token");
  localStorage.removeItem("lb_role");
  localStorage.removeItem("lb_username");
};
export const savedRole = () => localStorage.getItem("lb_role");
export const savedUser = () => localStorage.getItem("lb_username");

export default api;
