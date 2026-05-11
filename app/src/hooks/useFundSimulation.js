import { useEffect, useRef, useCallback } from 'react'
import { useFundStore } from '../store/fundStore'

export function useFundSimulationPolling(simulationId, { enabled = true, interval = 3000 } = {}) {
  const pollStatus = useFundStore((s) => s.pollStatus)
  const status = useFundStore((s) => s.simulationStatus)
  const timerRef = useRef(null)

  const isTerminal = status?.status === 'completed' || status?.status === 'failed'

  const poll = useCallback(async () => {
    if (!simulationId) return
    await pollStatus(simulationId)
  }, [simulationId, pollStatus])

  useEffect(() => {
    if (!enabled || !simulationId || isTerminal) return

    poll()
    timerRef.current = setInterval(poll, interval)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled, simulationId, isTerminal, poll, interval])

  return {
    status: status?.status || 'unknown',
    progress: status?.progress || 0,
    stage: status?.stage || '',
    message: status?.message || '',
    isTerminal,
    isRunning: status?.status === 'running' || status?.status === 'queued',
  }
}
