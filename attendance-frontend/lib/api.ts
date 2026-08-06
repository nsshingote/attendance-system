import axios from "axios";
import { getSession, clearSession, updateAccessToken } from "@/lib/auth";
import toast from "react-hot-toast";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

let refreshPromise: Promise<string> | null = null;
const refreshAccessToken = async (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
      .then(({ data }) => {
        updateAccessToken(data.access_token);
        return data.access_token as string;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

// Request interceptor - add token
api.interceptors.request.use(
  (config) => {
    const session = getSession();
    if (session?.token) {
      config.headers.Authorization = `Bearer ${session.token}`;
    }
    return config;
  },
  async (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Check if it's a validation error with details
    if (error.response?.data?.detail && Array.isArray(error.response.data.detail)) {
      // Pydantic validation error
      const validationErrors = error.response.data.detail;
      const messages = validationErrors.map((err: any) => {
        // Always return string
        if (typeof err === 'string') return err;
        if (err && typeof err === 'object' && err.msg) return String(err.msg);
        if (err && typeof err === 'object') return JSON.stringify(err);
        return String(err);
      });
      const errorMessage = messages.join(", ");
      console.error("Validation Error:", errorMessage);
      // Don't show toast here, let the component handle it
      return Promise.reject({ ...error, customMessage: errorMessage });
    }
    
    // Handle 401 - unauthorized
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };
    if (error.response?.status === 401 && !originalRequest?._retry && !String(originalRequest?.url || "").includes("/auth/refresh")) {
      const session = getSession();
      if (session?.token) {
        originalRequest._retry = true;
        try {
          const token = await refreshAccessToken();
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        } catch {
          clearSession();
          toast.error("Your session has ended. Please login again.");
          if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
        }
      }
    }
    
    // Check if it's a 422 validation error with the detail format
    if (error.response?.status === 422 && error.response?.data?.detail) {
      const detail = error.response.data.detail;
      let errorMessage = '';
      
      if (Array.isArray(detail)) {
        const messages = detail.map((err: any) => {
          if (typeof err === 'string') return err;
          if (err && typeof err === 'object' && err.msg) return String(err.msg);
          if (err && typeof err === 'object') return JSON.stringify(err);
          return String(err);
        });
        errorMessage = messages.join(", ");
      } else if (typeof detail === "string") {
        errorMessage = detail;
      } else {
        errorMessage = "Validation error";
      }
      
      // Store the custom message in the error object
      error.customMessage = errorMessage;
      return Promise.reject(error);
    }
    
    // If we have a custom message, use it
    if (error.customMessage) {
      return Promise.reject(error);
    }
    
    // Try to get a meaningful error message
    let errorMessage = "An error occurred";
    if (error.response?.data?.detail) {
      if (typeof error.response.data.detail === "string") {
        errorMessage = error.response.data.detail;
      } else if (Array.isArray(error.response.data.detail)) {
        const messages = error.response.data.detail.map((e: any) => {
          if (typeof e === 'string') return e;
          if (e && typeof e === 'object' && e.msg) return String(e.msg);
          if (e && typeof e === 'object') return JSON.stringify(e);
          return String(e);
        });
        errorMessage = messages.join(", ");
      } else {
        errorMessage = JSON.stringify(error.response.data.detail);
      }
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    error.customMessage = errorMessage;
    return Promise.reject(error);
  }
);

export default api;

export const getErrorMessage = (error: any): string => {
  if (error.customMessage) {
    return error.customMessage;
  }
  if (error.response?.data?.detail) {
    if (typeof error.response.data.detail === "string") {
      return error.response.data.detail;
    }
    if (Array.isArray(error.response.data.detail)) {
      const messages = error.response.data.detail.map((e: any) => {
        if (typeof e === "string") return e;
        if (e && typeof e === 'object' && e.msg) return String(e.msg);
        if (e && typeof e === 'object') return JSON.stringify(e);
        return String(e);
      });
      return messages.join(", ");
    }
    return JSON.stringify(error.response.data.detail);
  }
  if (error.message) {
    return error.message;
  }
  return "An unexpected error occurred";
};
