import { create } from 'zustand'
import { fundApi } from '../services/fundApi'

export const useFundStore = create((set, get) => ({
  // Parameters
  parameters: [],
  activeParameterId: null,
  defaultParameters: null,

  // Simulations
  simulations: [],
  activeSimulation: null,
  simulationStatus: null,

  // UI
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  // ── Parameters ──
  fetchParameters: async () => {
    try {
      const { data } = await fundApi.listParameters()
      set({ parameters: data || [] })
    } catch (err) {
      set({ error: err.message })
    }
  },

  fetchDefaultParameters: async () => {
    try {
      const { data } = await fundApi.getDefaultParameters()
      set({ defaultParameters: data })
      return data
    } catch (err) {
      set({ error: err.message })
    }
  },

  saveParameters: async (params) => {
    try {
      const { data } = await fundApi.createParameter(params)
      set((s) => ({ parameters: [data, ...s.parameters] }))
      return data
    } catch (err) {
      set({ error: err.message })
      throw err
    }
  },

  updateParameters: async (id, params) => {
    try {
      const { data } = await fundApi.updateParameter(id, params)
      set((s) => ({ parameters: s.parameters.map((p) => p.id === id ? data : p) }))
      return data
    } catch (err) {
      set({ error: err.message })
      throw err
    }
  },

  deleteParameters: async (id) => {
    try {
      await fundApi.deleteParameter(id)
      set((s) => ({ parameters: s.parameters.filter((p) => p.id !== id) }))
    } catch (err) {
      set({ error: err.message })
    }
  },

  // ── Simulations ──
  fetchSimulations: async (query) => {
    set({ loading: true, error: null })
    try {
      const { data } = await fundApi.listSimulations(query)
      set({ simulations: data || [], loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  startSimulation: async (params) => {
    set({ error: null })
    try {
      const { data } = await fundApi.startSimulation(params)
      return data
    } catch (err) {
      set({ error: err.message })
      throw err
    }
  },

  fetchSimulation: async (id) => {
    set({ loading: true, error: null })
    try {
      const { data } = await fundApi.getSimulation(id)
      set({ activeSimulation: data, loading: false })
      return data
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  pollStatus: async (id) => {
    try {
      const { data } = await fundApi.getSimulationStatus(id)
      set({ simulationStatus: data })
      return data
    } catch (err) {
      return get().simulationStatus
    }
  },

  deleteSimulation: async (id) => {
    try {
      await fundApi.deleteSimulation(id)
      set((s) => ({ simulations: s.simulations.filter((r) => r.id !== id) }))
    } catch (err) {
      set({ error: err.message })
    }
  },

  saveSimulation: async (id, name) => {
    try {
      const { data } = await fundApi.saveSimulation(id, name)
      set((s) => ({ simulations: s.simulations.map((r) => r.id === id ? { ...r, ...data } : r) }))
    } catch (err) {
      set({ error: err.message })
    }
  },

  // ── Cases ──
  submitCase: async (params) => {
    set({ error: null })
    try {
      const { data } = await fundApi.submitCase(params)
      return data
    } catch (err) {
      set({ error: err.message })
      throw err
    }
  },

  reset: () => set({
    parameters: [],
    activeParameterId: null,
    defaultParameters: null,
    simulations: [],
    activeSimulation: null,
    simulationStatus: null,
    loading: false,
    error: null,
  }),
}))
