import axios from 'axios'
const API_URL = import.meta.env.VITE_API_URL

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('access')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
