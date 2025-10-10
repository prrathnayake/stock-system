import axios from 'axios'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './auth'

const API_URL = import.meta.env.VITE_API_URL

export const api = axios.create({
  baseURL: API_URL,
  timeout: 12000
})

const refreshClient = axios.create({
  baseURL: API_URL,
  timeout: 12000
})

let refreshPromise = null

api.interceptors.request.use(config => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config
    if (!originalRequest) throw error

    const status = error.response?.status
    if (status === 401 && !originalRequest._retry) {
      const refreshToken = getRefreshToken()
      if (!refreshToken) {
        clearTokens()
        throw error
      }

      if (!refreshPromise) {
        refreshPromise = refreshClient
          .post('/auth/refresh', { refresh: refreshToken })
          .then(({ data }) => {
            setTokens(data.access, refreshToken)
            return data.access
          })
          .catch(err => {
            clearTokens()
            throw err
          })
          .finally(() => {
            refreshPromise = null
          })
      }

      try {
        const newToken = await refreshPromise
        originalRequest._retry = true
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch (refreshError) {
        throw refreshError
      }
    }

    throw error
  }
)
