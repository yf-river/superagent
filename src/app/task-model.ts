/** 看板任务及其持久附件；执行状态来自关联工单。 */
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export const TASK_STAGES = ['draft', 'queued', 'working', 'waiting', 'review', 'done', 'cancelled'] as const
export type TaskStage = typeof TASK_STAGES[number]
export type TaskStrategy = 'auto' | 'shared' | 'worktree'
export const TASK_PRIORITIES = ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent', 'none'] as const
export type TaskPriority = typeof TASK_PRIORITIES[number]
export type TaskAsset = { id: string; kind: 'image'; ref: ImageAttachmentRef } | { id: string; kind: 'file'; ref: FileAttachmentRef }
export interface TaskEvent { id: string; kind: string; text: string; assets: string[]; at: string }
export interface TaskRecord {
  id: string; revision: number; title: string; description: string; directory: string; strategy: TaskStrategy
  assets: string[]; sourceSession?: string; phase: 'draft' | 'submitted' | 'done' | 'cancelled'
  priority?: TaskPriority; dueDate?: string | null
  tickets: string[]; activeTicket?: string | null; run: number; routingError?: string; events: TaskEvent[]; createdAt: string; updatedAt: string
}
export interface TaskView extends Omit<TaskRecord, 'events'> {
  priority: TaskPriority; dueDate: string | null
  stage: TaskStage; attentionKind?: 'question' | 'routing' | 'failed' | 'blocked' | 'waiting'; retryable: boolean; summary: string; question?: string; sessionId?: string
  execution?: { directory: string; strategy: string; reason: string; branch?: string; baseCommit?: string }
}
/** 从已持久化工单和决定读取的路由记录，包括任务的历史执行轮次。 */
export interface TaskRoute {
  ticketId: string; decisionId: string; triggerId: string; at: string
  requestedStrategy: TaskStrategy; selectedStrategy: 'shared' | 'worktree'; reason: string; directory: string
}
export interface TaskDetail extends TaskView { events: TaskEvent[]; nextOffset?: number; attachments: TaskAsset[]; routes: TaskRoute[]; routerSessionId?: string }
export interface TaskList { items: TaskView[]; counts: Record<TaskStage, number>; priorityCounts: Record<TaskPriority, number>; nextOffset?: number }
export interface TaskCreate {
  requestId: string; title: string; description: string; directory: string; strategy?: TaskStrategy; assets?: string[]
  priority?: TaskPriority; dueDate?: string | null
}
export interface TaskCommand { requestId: string; revision: number; text?: string; assets?: string[] }
export interface TaskProperties { requestId: string; revision: number; priority?: TaskPriority; dueDate?: string | null }
