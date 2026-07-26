import axios from "axios";
import { getSession, clearSession } from "@/lib/auth";
import toast from "react-hot-toast";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor - add token
api.interceptors.request.use(
  (config) => {
    const session = getSession();
    if (session?.token) {
      config.headers.Authorization = `Bearer ${session.token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Check if it's a validation error with details
    if (error.response?.data?.detail && Array.isArray(error.response.data.detail)) {
      // Pydantic validation error
      const validationErrors = error.response.data.detail;
      const messages = validationErrors.map((err: any) => err.msg || JSON.stringify(err));
      const errorMessage = messages.join(", ");
      console.error("Validation Error:", errorMessage);
      // Don't show toast here, let the component handle it
      return Promise.reject({ ...error, customMessage: errorMessage });
    }
    
    // Handle 401 - unauthorized
    if (error.response?.status === 401) {
      const session = getSession();
      if (session?.token) {
        clearSession();
        toast.error("Session expired. Please login again.");
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      }
    }
    
    // Check if it's a 422 validation error with the detail format
    if (error.response?.status === 422 && error.response?.data?.detail) {
      const detail = error.response.data.detail;
      if (Array.isArray(detail)) {
        const messages = detail.map((err: any) => err.msg || JSON.stringify(err));
        const errorMessage = messages.join(", ");
        // Store the custom message in the error object
        error.customMessage = errorMessage;
      } else if (typeof detail === "string") {
        error.customMessage = detail;
      }
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
        errorMessage = error.response.data.detail.map((e: any) => e.msg || JSON.stringify(e)).join(", ");
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
        if (e.msg) return e.msg;
        return JSON.stringify(e);
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