export interface PushDelivery {
  delivery_id: string
  notification_id: string
  device_id: string
  push_token: string
  attempt_count: number
  family_id: string
  recipient_user_id: string
  notification_type: 'task_assigned' | 'task_reminder' | 'calendar_reminder' | 'system'
  title: string
  body: string | null
  source_type: 'task' | 'calendar_event' | 'system' | null
  source_id: string | null
}

export interface FcmServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

export interface FcmErrorBody {
  error?: {
    code?: number
    status?: string
    message?: string
    details?: Array<{
      '@type'?: string
      errorCode?: string
      fieldViolations?: Array<{ field?: string; description?: string }>
    }>
  }
}
