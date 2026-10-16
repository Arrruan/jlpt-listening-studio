import type { AiHealth, TranscriptionJob, TranscriptionResult } from './types'

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Keep the HTTP status when the local service did not return JSON.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const checkAiHealth = (baseUrl: string) =>
  request<AiHealth>(`${normalizeBaseUrl(baseUrl)}/api/health`)

export const startTranscription = (
  baseUrl: string,
  blob: Blob,
  fileName: string,
  modelSize: 'small' | 'medium',
) => {
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('model_size', modelSize)
  return request<TranscriptionJob>(`${normalizeBaseUrl(baseUrl)}/api/transcriptions`, {
    method: 'POST',
    body: form,
  })
}

export const getTranscriptionJob = (baseUrl: string, jobId: string) =>
  request<TranscriptionJob>(`${normalizeBaseUrl(baseUrl)}/api/transcriptions/${jobId}`)

export const getTranscriptionResult = (baseUrl: string, jobId: string) =>
  request<TranscriptionResult>(`${normalizeBaseUrl(baseUrl)}/api/transcriptions/${jobId}/result`)

export const cancelTranscription = (baseUrl: string, jobId: string) =>
  request<TranscriptionJob>(`${normalizeBaseUrl(baseUrl)}/api/transcriptions/${jobId}`, { method: 'DELETE' })
