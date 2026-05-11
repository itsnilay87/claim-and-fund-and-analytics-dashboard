import { api } from './api'

export const fundApi = {
  // Simulations
  startSimulation: (params) => api.post('/api/fund/simulations', params),
  listSimulations: (query = '') => api.get(`/api/fund/simulations${query ? `?${query}` : ''}`),
  getSimulation: (id) => api.get(`/api/fund/simulations/${id}`),
  getSimulationStatus: (id) => api.get(`/api/fund/simulations/${id}/status`),
  deleteSimulation: (id) => api.delete(`/api/fund/simulations/${id}`),
  saveSimulation: (id, name) => api.post(`/api/fund/simulations/${id}/save`, { name }),

  // Case simulations
  submitCase: (params) => api.post('/api/fund/case/submit', params),
  getCaseHistory: () => api.get('/api/fund/case/history'),

  // Parameters
  listParameters: () => api.get('/api/fund/parameters'),
  getParameter: (id) => api.get(`/api/fund/parameters/${id}`),
  getDefaultParameters: () => api.get('/api/fund/parameters/default'),
  createParameter: (data) => api.post('/api/fund/parameters', data),
  updateParameter: (id, data) => api.put(`/api/fund/parameters/${id}`, data),
  deleteParameter: (id) => api.delete(`/api/fund/parameters/${id}`),
}
