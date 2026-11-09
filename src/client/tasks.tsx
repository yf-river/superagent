/** 任务看板、创建表单和详情；完整执行过程由 DSH 会话呈现。 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDroppable, pointerWithin, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Virtuoso, GroupedVirtuoso } from 'react-virtuoso'
import { AlertTriangle, Target, Zap, Circle, Plus, MoreHorizontal, ListFilter, SlidersHorizontal, Columns3, List, Search, ArrowLeft, PanelRight, Check, Paperclip, FileText, Download, Eye } from 'lucide-react'
import { Button, Choice, Menu, Modal, DatePicker, ColumnMenu } from './multica/controls.tsx'
import { StatusIcon } from './multica/status-icon.tsx'
import { PortalScope, useDarkTheme } from './multica/portal.tsx'
import { useBoardDragPan } from './multica/use-board-drag-pan.ts'
import { useScrollMemory } from './multica/scroll-memory.ts'
import { ContentEditor } from './multica/editor.tsx'
import MULTICA_STYLES from './multica/generated.css?raw'
import FONT_STYLES from './multica/fonts.css?raw'

import type { TaskAsset, TaskCreate, TaskDetail, TaskList, TaskPriority, TaskStage, TaskStrategy, TaskView } from '../app/task-model.ts'
import { TASK_PRIORITIES, TASK_STAGES } from '../app/task-model.ts'
import { Icon, Input } from './controls.tsx'
import { usePoll } from './api.ts'
import type { T } from './text.ts'
import { taskCaller, type ApiTransport, type TaskCall } from './task-api.ts'
import STYLES from './client.css?raw'
import TASK_STYLES from './tasks.css?raw'

const taskHash = () => window.location.hash.match(/^#superagent\/tasks\/([a-f0-9-]{36})$/)?.[1]
const activeStages: TaskStage[] = TASK_STAGES.filter(stage => stage !== 'cancelled')
const titleOf = (t: T, stage: TaskStage) => t(`task.stage.${stage}`)
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure)
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path
const dueLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const overdue = (task: TaskView) => !!task.dueDate && task.dueDate < today() && !['done', 'cancelled'].includes(task.stage)
type DraggedTask = Pick<TaskView, 'id' | 'revision' | 'stage' | 'priority'>
type Scope = 'all' | 'waiting' | 'review'
interface Directory { id: string; path: string; title: string }
interface Preferences { view: 'board' | 'list'; q: string; directory: string; selected?: string; quadrants: boolean; summaries: boolean; hidden: TaskStage[]; priority: TaskPriority | ''; scope: Scope; order?: string[] }

function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(sessionStorage.getItem('superagent/tasks') ?? '{}') as Partial<Preferences>
    return { view: stored.view === 'list' ? 'list' : 'board', q: stored.q ?? '', directory: stored.directory ?? '',
      selected: taskHash() ?? stored.selected, quadrants: stored.quadrants ?? true, summaries: stored.summaries ?? true,
      hidden: Array.isArray(stored.hidden) ? stored.hidden.filter(stage => activeStages.includes(stage)) : [],
      order: Array.isArray(stored.order) ? stored.order.filter((id): id is string => typeof id === 'string') : [],
      priority: TASK_PRIORITIES.includes(stored.priority as TaskPriority) ? stored.priority as TaskPriority : '',
      scope: stored.scope === 'waiting' || stored.scope === 'review' ? stored.scope : 'all' }
  } catch { return { view: 'board', q: '', directory: '', selected: taskHash(), quadrants: true, summaries: true, hidden: [], priority: '', scope: 'all' } }
}

function PriorityIcon({ priority, t }: { priority: TaskPriority; t: T }) {
  const Glyph = priority === 'important_urgent' ? AlertTriangle : priority === 'important_not_urgent' ? Target : priority === 'not_important_urgent' ? Zap : Circle
  return <Glyph className={`size-3.5 shrink-0 st-priority-${priority}`} aria-hidden="true"/>
}
function PrioritySelect({ t, value, onChange, disabled }: { t: T; value: TaskPriority; onChange: (value: TaskPriority) => void; disabled?: boolean }) {
  return <Choice label={t('task.priority')} value={value} disabled={disabled} onChange={onChange} options={TASK_PRIORITIES.map(priority => ({value:priority,label:t(`task.priority.${priority}`),icon:<PriorityIcon priority={priority} t={t}/>}))}/>
}

async function encoded(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}

function Uploads({ t, call, assets, onChange, onBusy, incoming, disabled = false }: { t: T; call: TaskCall; assets: TaskAsset[]; onChange: (assets: TaskAsset[]) => void; onBusy: (busy: boolean) => void; incoming?: File[]; disabled?: boolean }) {
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false), input = useRef<HTMLInputElement>(null)
  const upload = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    setError(''); setUploading(true); onBusy(true)
    const added: TaskAsset[] = []
    try { for (const file of Array.from(files)) added.push(await call<TaskAsset>('POST', 'task-assets', { name: file.name, mediaType: file.type, data: await encoded(file) })) }
    catch (failure) { setError(message(failure)) }
    finally { onChange([...assets, ...added]); setUploading(false); onBusy(false) }
  }
  useEffect(() => { if (incoming?.length) void upload(incoming) }, [incoming])
  return <div className="st-uploads">
    <Button size="sm" variant="outline" icon={<Paperclip className="size-3.5"/>} disabled={disabled || uploading} onClick={() => input.current?.click()}>{uploading ? t('task.uploading') : t('task.attach')}</Button>
    <input ref={input} aria-label={t('task.attach')} className="st-file-input" type="file" multiple disabled={disabled || uploading}
      onChange={event => { void upload(event.target.files); event.target.value = '' }}/>
    {assets.map(asset => <span className="st-attachment" key={asset.id}>{asset.ref.name ?? asset.id}<Button size="sm" disabled={disabled || uploading}
      aria-label={t('task.removeAttachment', { name: asset.ref.name ?? asset.id })} onClick={() => onChange(assets.filter(item => item.id !== asset.id))}><Icon name="close" size={12}/></Button></span>)}
    {error && <p role="alert" className="dt-error">{error}</p>}
  </div>
}

function TaskForm({ t, call, directories, initial, defaults, onClose, onSaved }: { t: T; call: TaskCall; directories: Directory[]; initial?: TaskDetail; defaults: { directory: string; priority: TaskPriority }; onClose: () => void; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? ''), [description, setDescription] = useState(initial?.description ?? ''), [directory, setDirectory] = useState(initial?.directory ?? defaults.directory)
  const [strategy, setStrategy] = useState<TaskStrategy>(initial?.strategy ?? 'auto'), [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? defaults.priority), [dueDate, setDueDate] = useState<string | null>(initial?.dueDate ?? null)
  const [assets, setAssets] = useState<TaskAsset[]>(initial?.attachments.filter(asset => initial.assets.includes(asset.id)) ?? []), [files, setFiles] = useState<File[]>()
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [advanced, setAdvanced] = useState(false)
  const requestId = useRef(crypto.randomUUID()), submitted = useRef(false)
  const changed = () => { requestId.current = crypto.randomUUID() }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (submitted.current || uploading) return
    if (!title.trim() || !description.trim() || !directory.trim()) { setError(t('task.requiredFields')); return }
    submitted.current = true; setBusy(true); setError('')
    const body: TaskCreate = { requestId: requestId.current, title, description, directory, strategy, priority, dueDate, assets: assets.map(asset => asset.id) }
    try { const value = await call<TaskDetail>(initial ? 'PUT' : 'POST', initial ? `tasks/${initial.id}` : 'tasks', initial ? { ...body, revision: initial.revision } : body); onSaved(value.id) }
    catch (failure) { setError(message(failure)) }
    finally { submitted.current = false; setBusy(false) }
  }
  const close = () => { if (!busy && !uploading) onClose() }
  return <Modal onClose={close} title={initial ? t('task.edit') : t('task.create')} closeLabel={t('close')} disabled={busy || uploading} className="st-form-modal max-w-2xl">
    <form onSubmit={event => { void submit(event) }} className="st-form flex min-h-0 flex-1 flex-col" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.requestSubmit() } }}>
      <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col border-0 p-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4">
          <input className="st-title-input w-full bg-transparent text-title-lg font-medium outline-none" required maxLength={200} aria-label={t('task.title')} placeholder={t('task.titlePlaceholder')} value={title} onChange={event => { setTitle(event.target.value); changed() }}/>
          <div className="mt-3 flex-1"><ContentEditor t={t} value={description} label={t('task.description')} placeholder={t('task.descriptionPlaceholder')} disabled={busy} onFiles={setFiles} onChange={value => { setDescription(value); changed() }}/></div>
          {advanced && <label className="my-3 flex items-center gap-3 text-caption text-muted-foreground">{t('task.executionMode')}<Choice label={t('task.executionMode')} value={strategy} onChange={value=>{setStrategy(value);changed()}} options={(['auto','shared','worktree'] as const).map(value=>({value,label:t(`task.strategy.${value}`)}))}/></label>}
          {error && <p className="st-error" role="alert">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <label className="st-directory-picker flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-caption"><Icon name="folder" size={13}/><input required list="st-directories" className="min-w-0 max-w-52 bg-transparent outline-none" aria-label={t('task.projectDirectory')} value={directory} placeholder={t('task.projectDirectory')} onChange={event=>{setDirectory(event.target.value);changed()}}/></label>
          <datalist id="st-directories">{directories.map(item => <option value={item.path} key={item.id}>{item.title}</option>)}</datalist>
          <PrioritySelect t={t} value={priority} onChange={value => { setPriority(value); changed() }}/><DatePicker t={t} value={dueDate} onChange={value=>{setDueDate(value);changed()}}/>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><div className="flex min-w-0 items-center gap-2"><Uploads t={t} call={call} assets={assets} incoming={files} onChange={next => { setAssets(next); changed() }} onBusy={setUploading}/>
          <Button aria-label={t('task.advanced')} aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><MoreHorizontal className="size-4"/></Button></div>
          <Button type="submit" variant="primary" disabled={busy || uploading}>{busy ? t('task.saving') : t('task.saveDraft')}</Button>
        </div>
      </fieldset>
      <p className="px-4 pb-3 text-micro text-muted-foreground">{t('task.draftHint')}</p>
    </form>
  </Modal>
}

function Card({ task, t, summaries, busy, onOpen, onAction, overlay = false }: { task: TaskView; t: T; summaries: boolean; busy: boolean; onOpen: () => void; onAction: (task: TaskView, action: string) => void; overlay?: boolean }) {
  return <article className="group/card" data-stage={task.stage}>
    <a className="st-card block rounded-lg border-[0.5px] border-surface-border bg-surface px-2.5 py-3 shadow-[var(--surface-shadow)] transition-colors hover:border-foreground/15 hover:bg-surface-hover"
      href={`#superagent/tasks/${task.id}`} tabIndex={overlay ? -1 : 0} onClick={event => { event.preventDefault(); if (!overlay) onOpen() }}>
      <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-1.5"><span className="inline-flex size-5 shrink-0 items-center justify-center"><PriorityIcon priority={task.priority} t={t}/></span>
        <p className="truncate text-caption text-muted-foreground">{task.id.slice(0, 8).toUpperCase()}</p></div>
        {task.stage === 'working' && <span className="st-running-dot" aria-label={titleOf(t, task.stage)}/>}</div>
      <p className="mt-1 line-clamp-2 text-body font-medium leading-snug">{task.title}</p>
      {summaries && (task.question || task.summary || task.description) && <p className="mt-1 line-clamp-1 text-caption text-muted-foreground">{(task.question || task.summary || task.description).replace(/[#*`>]/g, '')}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground" title={task.directory}><Icon name="folder" size={12}/><span className="truncate">{folderName(task.directory)}</span></span></div>
      <div className="mt-2 flex items-center justify-between gap-2 text-caption text-muted-foreground"><span>{task.attentionKind ? t(`task.attention.${task.attentionKind}`) : titleOf(t, task.stage)}</span>
        {task.dueDate ? <time className={overdue(task) ? 'text-destructive' : ''} dateTime={task.dueDate}><Icon name="calendar" size={12}/>{dueLabel(task.dueDate)}</time> : <time dateTime={task.updatedAt}>{date(task.updatedAt)}</time>}
      </div>
    </a>
  </article>
}

/** 逐页读取用户展开的范围，每次请求遵守服务端页大小。 */
async function taskPage(call: TaskCall, query: URLSearchParams, wanted: number): Promise<TaskList> {
  const result: TaskView[] = []; let offset = 0; let page: TaskList
  do {
    const params = new URLSearchParams(query); params.set('offset', String(offset)); params.set('limit', String(Math.min(200, wanted - result.length)))
    page = await call<TaskList>('GET', `tasks?${params}`); result.push(...page.items)
    if (page.nextOffset === undefined) break
    offset = page.nextOffset
  } while (result.length < wanted)
  return { ...page!, items: result }
}

type Move = (task: DraggedTask, stage: TaskStage, priority?: TaskPriority) => Promise<void>
type CardProps = Parameters<typeof Card>[0]
function DraggableCard(props: CardProps & { order: string[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id, data: { task: props.task, stage: props.task.stage, priority: props.task.priority, order: props.order }, disabled: props.busy })
  return <div ref={setNodeRef} data-board-card="" className={isDragging ? 'opacity-30' : ''} style={{ transform: CSS.Transform.toString(transform), transition, touchAction: 'pan-y' }} {...attributes} {...listeners}>
    <Card {...props}/>
  </div>
}
function MoreTasks({ onMore }: { onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) onMore() }, { rootMargin: '100px' })
    observer.observe(ref.current); return () => observer.disconnect()
  }, [onMore])
  return <div ref={ref} className="h-8"/>
}
function Quadrant({ stage, priority, children, count, t }: { stage: TaskStage; priority: TaskPriority; children: ReactNode; count: number; t: T }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${stage}/${priority}`, data: { stage, priority } })
  const key = `superagent/quadrant/${stage}/${priority}`, contentId = useId()
  const [choice, setChoice] = useState<boolean | undefined>(() => {
    try { const stored = localStorage.getItem(key); return stored === 'true' ? true : stored === 'false' ? false : undefined }
    catch (error) { void error; return undefined }
  })
  const [springOpen, setSpringOpen] = useState(false)
  const expanded = springOpen || (choice ?? count > 0)
  useEffect(() => {
    if (!isOver || expanded) return
    const timer = setTimeout(() => setSpringOpen(true), 500)
    return () => clearTimeout(timer)
  }, [isOver, expanded])
  const toggle = () => {
    const next = !expanded; setSpringOpen(false); setChoice(next)
    try { localStorage.setItem(key, String(next)) } catch (error) { void error /* 当前页面仍保留用户选择。 */ }
  }
  return <section ref={setNodeRef} className={`rounded-md border p-2 ${isOver ? 'bg-accent/60 ring-2 ring-brand/25' : 'bg-background/40'}`} aria-label={t(`task.priority.${priority}`)}>
    <button type="button" className="st-quadrant-toggle flex w-full items-center justify-between gap-2 rounded text-left" aria-expanded={expanded} aria-controls={contentId} onClick={toggle}>
      <span className="flex items-center gap-1.5 text-caption font-medium"><Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12}/><PriorityIcon priority={priority} t={t}/>{t(`task.priority.${priority}`)}</span><span className="text-micro text-muted-foreground">{count}</span>
    </button>
    <div id={contentId} hidden={!expanded} className="mt-1">{count ? <div className="space-y-2">{children}</div> : <p className="py-3 text-center text-micro text-muted-foreground">{t('task.emptyColumn')}</p>}</div>
  </section>
}
function TaskLane({ stage, t, call, prefs, version, busy, canHide, onOpen, onCreate, onHide, onAction }: { stage: TaskStage; t: T; call: TaskCall; prefs: Preferences; version: number; busy: boolean; canHide: boolean; onOpen: (id: string) => void; onCreate: (priority?: TaskPriority) => void; onHide: () => void; onAction: (task: TaskView, action: string) => void }) {
  const [limit, setLimit] = useState(60), [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const query = new URLSearchParams({ q: prefs.q, directory: prefs.directory, stage, ...(prefs.priority ? { priority: prefs.priority } : {}) })
  const queryKey = query.toString()
  useEffect(() => setLimit(60), [queryKey])
  const { data, error } = usePoll(() => taskPage(call, query, limit), [call, queryKey, limit, version])
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } })
  const scroll = useScrollMemory<HTMLDivElement>(`board/${queryKey}`, !!data)
  const mergeRef = useCallback((element: HTMLDivElement | null) => { setNodeRef(element); setScrollEl(element); scroll.ref(element) }, [setNodeRef, scroll.ref])
  const more = useCallback(() => setLimit(value => value + 60), [])
  const items = useMemo(() => {
    const order = prefs.order ?? [], rank = new Map(order.map((id,index)=>[id,index]))
    return [...(data?.items ?? [])].sort((a,b)=>(rank.get(a.id) ?? 100000)-(rank.get(b.id) ?? 100000))
  }, [data,prefs.order])
  const card = (task: TaskView) => <DraggableCard order={items.map(item=>item.id)} key={task.id} task={task} t={t} summaries={prefs.summaries} busy={busy} onOpen={() => onOpen(task.id)} onAction={onAction}/>
  const footer = data?.nextOffset !== undefined ? <MoreTasks onMore={more}/> : null
  return <section className={`st-column st-column-${stage} flex w-[280px] shrink-0 flex-col rounded-xl p-2`} aria-label={titleOf(t, stage)}>
    <header className="mb-2 flex h-7 shrink-0 items-center justify-between px-1.5"><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 text-caption font-semibold"><StatusIcon stage={stage} className="size-3"/>{titleOf(t, stage)}</span><span className="text-caption text-muted-foreground">{data?.counts[stage] ?? '–'}</span></div>
      <div className="flex items-center gap-1"><ColumnMenu label={t('task.columnMenu', { stage: titleOf(t, stage) })} t={t} disabled={!canHide} onHide={onHide}/>
        {stage === 'draft' && <Button size="sm" aria-label={t('task.create')} className="size-6 rounded-full p-0 text-muted-foreground" onClick={() => onCreate()}><Plus className="size-3.5"/></Button>}</div>
    </header>
    <div className="relative min-h-[200px] flex-1 rounded-lg"><div ref={mergeRef} data-scroll-column={stage} className={`absolute inset-0 overflow-y-auto rounded-lg p-1 transition-colors ${isOver ? 'bg-accent/60' : ''}`}>
      {error && <p role="alert" className="st-error">{error.message}</p>}{!data && !error && <p className="py-8 text-center text-caption text-muted-foreground">{t('loading')}</p>}
      {data && <SortableContext items={items.map(task => task.id)} strategy={verticalListSortingStrategy}>
        {prefs.quadrants && stage === 'draft' ? <div className="space-y-3">{TASK_PRIORITIES.filter(priority => priority !== 'none' || items.some(task => task.priority === 'none')).map(priority => {
          const grouped = items.filter(task => task.priority === priority)
          return <Quadrant key={priority} stage={stage} priority={priority} t={t} count={data.priorityCounts?.[priority] ?? grouped.length}>{grouped.map(card)}</Quadrant>
        })}{footer}</div>
        : items.length > 30 && scrollEl ? <Virtuoso customScrollParent={scrollEl} data={items} computeItemKey={(_i, task) => task.id} initialScrollTop={scroll.offset.top} initialItemCount={Math.min(items.length,10)} defaultItemHeight={140} increaseViewportBy={{top:300,bottom:300}}
          components={{Footer:() => footer}} itemContent={(index, task) => <div className={index ? 'pt-2' : ''}>{card(task)}</div>}/>
          : <><div className="space-y-2">{items.map(card)}</div>{!items.length && <p className="py-8 text-center text-caption text-muted-foreground">{t('task.emptyColumn')}</p>}{footer}</>}
      </SortableContext>}
    </div></div>
  </section>
}
function TaskBoard({ children, t, busy, onMove, onOrder }: { children: ReactNode; t: T; busy: boolean; onMove: Move; onOrder: (order:string[])=>void }) {
  const pan = useBoardDragPan<HTMLElement>(), scroll = useScrollMemory<HTMLElement>('board-horizontal')
  const ref = useCallback((element: HTMLElement | null) => { pan.ref.current = element; scroll.ref(element) }, [pan.ref, scroll.ref])
  const [dragged, setDragged] = useState<TaskView>()
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, arrayMove }))
  const end = (event: DragEndEvent) => {
    setDragged(undefined)
    const task = event.active.data.current?.task as TaskView | undefined, target = event.over?.data.current as {stage?:TaskStage;priority?:TaskPriority} | undefined
    if (!task || !target?.stage || busy) return
    if (task.stage === target.stage && (!target.priority || target.priority === task.priority)) {
      const order = event.active.data.current?.order as string[] | undefined
      if (order && event.over && event.over.id !== task.id) {
        const from=order.indexOf(task.id), to=order.indexOf(String(event.over.id))
        if(from>=0 && to>=0) onOrder(arrayMove(order,from,to))
      }
      return
    }
    void onMove(task, target.stage, target.priority)
  }
  return <DndContext sensors={sensors} collisionDetection={args => { const collisions = pointerWithin(args); const cards=collisions.filter(hit=>args.droppableContainers.find(container=>container.id===hit.id)?.data.current?.task); return cards.length?cards:collisions.length?collisions:closestCenter(args) }}
    onDragStart={event => setDragged(event.active.data.current?.task as TaskView)} onDragEnd={end} onDragCancel={() => setDragged(undefined)}>
    <main {...pan} ref={ref} className={`st-board flex min-h-0 flex-1 gap-4 overflow-x-auto p-2 ${dragged ? 'st-dragging' : ''}`} aria-label={t('task.board')}>{children}</main>
    <DragOverlay dropAnimation={null}>{dragged && <div className="w-[256px] cursor-grabbing"><Card task={dragged} t={t} summaries busy overlay onOpen={() => {}} onAction={() => {}}/></div>}</DragOverlay>
  </DndContext>
}
function TaskListView({ tasks, t, prefs, busy, onOpen, onAction }: { tasks: TaskView[]; t:T; prefs:Preferences; busy:boolean; onOpen:(id:string)=>void; onAction:(task:TaskView,action:string)=>void }) {
  const scroll = useScrollMemory<HTMLElement>(`list/${prefs.q}/${prefs.directory}/${prefs.priority}/${prefs.scope}`, !!tasks.length)
  const [element,setElement]=useState<HTMLElement|null>(null)
  const ref=useCallback((el:HTMLElement|null)=>{setElement(el);scroll.ref(el)},[scroll.ref])
  const groups=activeStages.filter(stage=>!prefs.hidden.includes(stage)).map(stage=>({stage,items:tasks.filter(task=>task.stage===stage)})).filter(group=>group.items.length)
  const ordered=groups.flatMap(group=>group.items)
  const heading=(group:typeof groups[number])=><header className="flex h-9 items-center gap-2 border-b bg-background px-4 text-caption font-semibold"><StatusIcon stage={group.stage}/>{titleOf(t,group.stage)}<span className="font-normal text-muted-foreground">{group.items.length}</span></header>
  const row=(task:TaskView)=><a key={task.id} href={`#superagent/tasks/${task.id}`} className="st-list-row flex h-9 items-center gap-3 border-b border-border/50 px-4 text-body hover:bg-muted/40" onClick={event=>{event.preventDefault();onOpen(task.id)}}>
    <StatusIcon stage={task.stage}/><span className="w-20 shrink-0 text-caption text-muted-foreground">{task.id.slice(0,8).toUpperCase()}</span><PriorityIcon priority={task.priority} t={t}/><span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
    <span className="st-list-directory max-w-36 truncate text-caption text-muted-foreground" title={task.directory}>{folderName(task.directory)}</span>{task.dueDate&&<time className={`shrink-0 text-caption ${overdue(task)?'text-destructive':'text-muted-foreground'}`}>{dueLabel(task.dueDate)}</time>}
  </a>
  return <main ref={ref} className="st-list min-h-0 flex-1 overflow-auto p-2 pt-0" aria-label={t('task.list')}>{!tasks.length?<p className="py-8 text-center text-caption text-muted-foreground">{t('task.noMatches')}</p>:
    tasks.length>30&&element?<GroupedVirtuoso customScrollParent={element} groupCounts={groups.map(group=>group.items.length)} groupContent={index=>heading(groups[index]!)} itemContent={index=>row(ordered[index]!)} computeItemKey={index=>ordered[index]!.id} initialItemCount={Math.min(tasks.length,30)} initialScrollTop={scroll.offset.top} defaultItemHeight={36} increaseViewportBy={{top:300,bottom:300}}/>:
    groups.map(group=><section key={group.stage}>{heading(group)}{group.items.map(row)}</section>)}
  </main>
}

function Attachment({ asset, t, call }: { asset: TaskAsset; t: T; call: TaskCall }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const download = async () => {
    setBusy(true); setError('')
    try {
      const value = await call<{ data: string; mediaType: string; name: string }>('GET', `task-assets/${asset.id}`)
      const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: value.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = value.name || asset.id; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  const [preview,setPreview]=useState<string>()
  const inspect=async()=>{
    setBusy(true);setError('')
    try{const value=await call<{data:string;mediaType:string}>('GET',`task-assets/${asset.id}`);setPreview(`data:${value.mediaType};base64,${value.data}`)}
    catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <div className="st-file flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 transition-colors hover:bg-muted">
    <FileText className="size-4 shrink-0 text-muted-foreground"/><button type="button" disabled={busy} className="min-w-0 flex-1 text-left" onClick={()=>{void download()}}><span className="block truncate text-body">{asset.ref.name??t('task.image')}</span><span className="text-micro text-muted-foreground">{Math.ceil(asset.ref.bytes/1024)} KB</span></button>
    {asset.kind==='image'&&<Button size="sm" aria-label={t('task.previewImage')} disabled={busy} onClick={()=>{void inspect()}}><Eye className="size-3.5"/></Button>}
    <Button size="sm" aria-label={t('task.downloadAttachment')} disabled={busy} onClick={()=>{void download()}}><Download className="size-3.5"/></Button>
    {error&&<span role="alert" className="st-error">{error}</span>}
    {preview&&<Modal title={asset.ref.name??t('task.image')} closeLabel={t('close')} onClose={()=>setPreview(undefined)} className="max-w-3xl"><div className="flex min-h-0 items-center justify-center overflow-auto p-4"><img src={preview} alt={asset.ref.name??t('task.image')} className="max-h-[70dvh] max-w-full object-contain"/></div></Modal>}
  </div>
}

function Detail({ id, version, t, call, onClose, onChanged, onEdit, openSession }: { id: string; version: number; t: T; call: TaskCall; onClose: () => void; onChanged: () => Promise<unknown>; onEdit: (task: TaskDetail) => void; openSession: (id: string) => Promise<void> }) {
  const [showProperties,setShowProperties] = useState(true), [cancelling,setCancelling] = useState(false), [files,setFiles] = useState<File[]>()
  const detailRoot=useRef<HTMLElement>(null)
  useEffect(()=>{ detailRoot.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true}) },[])
  const { data, error, reload } = usePoll(() => call<TaskDetail>('GET', `tasks/${id}`), [call, id, version])
  const [text, setText] = useState(''), [assets, setAssets] = useState<TaskAsset[]>([]), [uploading, setUploading] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  const [older, setOlder] = useState<TaskDetail['events']>([]), [nextOffset, setNextOffset] = useState<number>(), running = useRef(false), request = useRef<{ action: string; id: string }>()
  const run = async (action: string, properties?: { priority?: TaskPriority; dueDate?: string | null }) => {
    if (!data || running.current || uploading) return
    running.current = true; setBusy(true); setFailure('')
    const key = action + JSON.stringify(properties ?? {})
    if (request.current?.action !== key) request.current = { action: key, id: crypto.randomUUID() }
    try {
      await call(properties ? 'PUT' : 'POST', `tasks/${id}/${action}`, { requestId: request.current.id, revision: data.revision, ...properties,
        ...action === 'note' ? { text, assets: assets.map(asset => asset.id) } : {} })
      request.current = undefined
      if (action === 'note') { setText(''); setAssets([]) }
      await Promise.all([reload(), onChanged()])
    } catch (error) { setFailure(message(error)); await reload() }
    finally { running.current = false; setBusy(false) }
  }
  const more = async () => {
    if (!data) return
    setBusy(true)
    try { const page = await call<TaskDetail>('GET', `tasks/${id}?offset=${nextOffset ?? data.nextOffset}`); setOlder(items => [...items, ...page.events]); setNextOffset(page.nextOffset) }
    catch (error) { setFailure(message(error)) }
    finally { setBusy(false) }
  }
  const availableMore = older.length ? nextOffset !== undefined : data?.nextOffset !== undefined
  const scroll = useScrollMemory<HTMLDivElement>(`detail/${id}`, !!data)
  const closed = data?.phase === 'done' || data?.phase === 'cancelled'
  const open = async (session: string) => { try { await openSession(session); onClose() } catch (error) { setFailure(message(error)) } }
  return <section ref={detailRoot} className="st-detail-page absolute inset-0 z-20 flex min-h-0 bg-background" aria-label={t('task.details')}>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button aria-label={t('task.backToTasks')} onClick={onClose}><ArrowLeft className="size-4"/></Button>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-body"><Icon name="folder" size={14}/><span className="shrink-0 text-muted-foreground">{data ? folderName(data.directory) : ''}</span><span className="text-faint-foreground">›</span><span className="truncate">{data ? `${data.id.slice(0,8).toUpperCase()} ${data.title}` : t('loading')}</span></span>
        <Button aria-label={t('task.toggleProperties')} aria-pressed={showProperties} onClick={()=>setShowProperties(!showProperties)}><PanelRight className="size-4"/></Button>
      </header>
      <div ref={scroll.ref} className="st-detail-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        {error && <p className="st-error" role="alert">{error.message}</p>}
        {!data && !error && <p className="p-6 text-caption text-muted-foreground">{t('loading')}</p>}
        {data && <div className="st-detail-body mx-auto w-full max-w-4xl px-10 py-8">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-caption text-muted-foreground"><StatusIcon stage={data.stage}/>{data.attentionKind ? t(`task.attention.${data.attentionKind}`) : titleOf(t,data.stage)}
            <div className="ml-auto flex items-center gap-2">
              {data.phase === 'draft' && <><Button variant="primary" disabled={busy} icon={<Icon name="play" size={14}/>} onClick={()=>{void run('start')}}>{t('task.start')}</Button><Button disabled={busy} onClick={()=>onEdit(data)}>{t('task.edit')}</Button></>}
              {data.stage === 'review' && <Button variant="primary" disabled={busy} onClick={()=>{void run('confirm')}}>{t('task.confirmDone')}</Button>}
              {data.retryable && <Button disabled={busy} onClick={()=>{void run('retry')}}>{t('task.retry')}</Button>}
              <Menu compact label={t('task.actions')} icon={<MoreHorizontal className="size-4"/>}>{closed ? <Button disabled={busy} onClick={()=>{void run('reopen')}}>{t('task.reopen')}</Button> : <Button disabled={busy} onClick={()=>setCancelling(true)}>{t('task.cancelTask')}</Button>}</Menu>
            </div>
          </div>
          <h1 className="mb-5 break-words text-display-sm font-semibold">{data.title}</h1>
          {failure && <p role="alert" className="st-error">{failure}</p>}
          {data.question && <section className="mb-5 rounded-lg border border-warning/30 bg-warning/5 p-4"><h2 className="mb-2 text-body font-medium">{t('task.needsAnswer')}</h2><ContentEditor t={t} readOnly label={t('task.needsAnswer')} value={data.question}/></section>}
          <ContentEditor t={t} readOnly label={t('task.description')} value={data.description}/>
          {data.summary && <section className="mt-6 rounded-lg border p-4"><h2 className="mb-3 text-body font-medium">{data.stage === 'review' ? t('task.result') : t('task.progress')}</h2><ContentEditor t={t} readOnly label={t('task.result')} value={data.summary}/></section>}
          {data.stage === 'review' && <p className="mt-3 text-caption text-muted-foreground">{t('task.acceptanceHint')}</p>}
          {!!data.attachments.length && <div className="st-attachments mt-5">{data.attachments.map(asset=><Attachment key={asset.id} asset={asset} t={t} call={call}/>)}</div>}
          <section className="mt-10 border-t pt-8"><h2 className="mb-5 text-title-sm font-semibold">{t('task.activity')}</h2>
            {availableMore && <Button disabled={busy} onClick={()=>{void more()}}>{t('loadMore')}</Button>}
            <ol className="st-timeline">{[...new Map([...data.events,...older].map(event=>[event.id,event])).values()].sort((a,b)=>a.at.localeCompare(b.at)).map(event=><li key={event.id} className="flex items-start gap-3 py-2.5 text-caption">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/40"/><div className="min-w-0 flex-1"><ContentEditor t={t} readOnly label={t('task.activity')} value={event.kind === 'properties' ? t('task.metadataUpdated') : event.text}/>
              {!!event.assets.length && <div className="st-attachments">{data.attachments.filter(asset=>event.assets.includes(asset.id)).map(asset=><Attachment key={asset.id} asset={asset} t={t} call={call}/>)}</div>}</div><time className="shrink-0 text-micro text-muted-foreground">{date(event.at)}</time>
            </li>)}</ol>
          </section>
          {!closed && <form className="st-note mt-6 rounded-xl border bg-surface" onSubmit={event=>{event.preventDefault();void run('note')}}>
            <ContentEditor t={t} value={text} label={t('task.followup')} placeholder={t('task.followup')} disabled={busy || uploading} onFiles={setFiles} onChange={value=>{setText(value);request.current=undefined}}/>
            <div className="flex items-center justify-between gap-3 px-2 pb-2"><Uploads t={t} call={call} assets={assets} incoming={files} onChange={next=>{setAssets(next);request.current=undefined}} onBusy={setUploading} disabled={busy}/>
              <Button type="submit" variant="primary" disabled={busy || uploading || (!text.trim() && !assets.length)}>{t('task.send')}</Button></div>
          </form>}
        </div>}
      </div>
    </div>
    {showProperties && <aside className="st-detail-properties flex w-80 shrink-0 flex-col border-l bg-background">
      <header className="flex h-12 shrink-0 items-center border-b px-5 text-body font-medium">{t('task.properties')}</header>
      {data && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-caption">
        <h2 className="mb-4 font-medium">{t('task.properties')}</h2>
        <dl className="st-property-grid"><dt>{t('task.statusFilter')}</dt><dd><StatusIcon stage={data.stage}/>{titleOf(t,data.stage)}</dd>
          <dt>{t('task.priority')}</dt><dd><PrioritySelect t={t} value={data.priority} disabled={busy} onChange={priority=>{void run('properties',{priority})}}/></dd>
          <dt>{t('task.dueDate')}</dt><dd><DatePicker t={t} value={data.dueDate} disabled={busy} onChange={dueDate=>{void run('properties',{dueDate})}}/></dd>
          <dt>{t('task.projectDirectory')}</dt><dd className="break-all" title={data.directory}><Icon name="folder" size={13}/>{data.directory}</dd>
        </dl>
        <section className="mt-8"><h2 className="mb-4 font-medium">{t('task.executionMode')}</h2><dl className="st-property-grid"><dt>{t('task.executionMode')}</dt><dd>{t(`task.strategy.${data.strategy}`)}</dd>
          {data.execution && <><dt>{t('task.actualDirectory')}</dt><dd className="break-all">{data.execution.directory}</dd>{data.execution.branch && <><dt>{t('task.branch')}</dt><dd className="break-all">{data.execution.branch}</dd></>}{data.execution.baseCommit && <><dt>{t('task.baseline')}</dt><dd className="break-all">{data.execution.baseCommit}</dd></>}</>}
        </dl></section>
        <div className="mt-6 flex flex-col items-start gap-2">{data.sessionId && <Button variant="outline" icon={<Icon name="session" size={14}/>} onClick={()=>{void open(data.sessionId!)}}>{t('task.openSession')}</Button>}
          {data.sourceSession && <Button onClick={()=>{void open(data.sourceSession!)}}>{t('task.sourceSession')}</Button>}</div>
        <details className="st-routing mt-6"><summary className="cursor-pointer text-caption font-medium">{t('task.routing')}</summary>
          {!data.routes.length && <p className="mt-3 leading-5 text-muted-foreground">{t('task.routingPending')}</p>}
          {data.routes.map(route=><div className="mt-4 border-l pl-3 leading-5" key={route.ticketId}><time className="text-micro text-muted-foreground">{date(route.at)}</time>
            <dl className="st-property-grid mt-2"><dt>{t('task.requestedStrategy')}</dt><dd>{t(`task.strategy.${route.requestedStrategy}`)}</dd><dt>{t('task.selectedStrategy')}</dt><dd>{t(`task.strategy.${route.selectedStrategy}`)}</dd></dl>
            <p className="mt-2">{route.reason}</p><dl className="mt-2 break-all text-micro text-muted-foreground"><dt>{t('task.ticketId')}</dt><dd>{route.ticketId}</dd><dt>{t('task.decisionId')}</dt><dd>{route.decisionId}</dd></dl></div>)}
          {data.routerSessionId && <Button size="sm" onClick={()=>{void open(data.routerSessionId!)}}>{t('task.openRouter')}</Button>}
        </details>
      </div>}
    </aside>}
    {cancelling && <Modal title={t('task.cancelTask')} onClose={()=>setCancelling(false)} closeLabel={t('close')} className="max-w-sm"><p className="p-4 text-body">{t('task.cancelConfirm')}</p><div className="flex justify-end gap-2 border-t p-3"><Button onClick={()=>setCancelling(false)}>{t('close')}</Button><Button variant="primary" disabled={busy} onClick={()=>{setCancelling(false);void run('cancel')}}>{t('task.cancelTask')}</Button></div></Modal>}
  </section>
}

/** 侧边栏默认任务入口；卸载后轮询和局部交互随页面释放。 */
export function TaskPanel({ t, transport, openSession, onSettings }: { t: T; transport: ApiTransport; openSession: (id: string) => Promise<void>; onSettings: () => void }) {
  const dark = useDarkTheme()
  const [prefs, setPrefs] = useState(readPreferences), [stage, setStage] = useState<TaskStage>(), [limit, setLimit] = useState(50)
  const [version, setVersion] = useState(0), [creating, setCreating] = useState<{ priority: TaskPriority }>(), [editing, setEditing] = useState<TaskDetail>(), [debounced, setDebounced] = useState(prefs.q)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), actionRunning = useRef(false), pending = useRef<{ key: string; id: string }>()
  const lastSelected=useRef<string>()
  useEffect(()=>{
    if(prefs.selected){lastSelected.current=prefs.selected;return}
    if(lastSelected.current){document.querySelector<HTMLAnchorElement>(`.st-card[href="#superagent/tasks/${lastSelected.current}"]`)?.focus({preventScroll:true});lastSelected.current=undefined}
  },[prefs.selected])
  const call = useMemo(() => taskCaller(transport), [transport])
  useEffect(() => { try { sessionStorage.setItem('superagent/tasks', JSON.stringify(prefs)) } catch (error) { void error /* 视图偏好不影响任务持久化。 */ } }, [prefs])
  useEffect(() => { const timer = setTimeout(() => setDebounced(prefs.q), 200); return () => clearTimeout(timer) }, [prefs.q])
  const selectedStage = stage ?? (prefs.scope === 'all' ? undefined : prefs.scope)
  const query = new URLSearchParams({ q: debounced, directory: prefs.directory, ...(selectedStage ? { stage: selectedStage } : {}), ...(prefs.priority ? { priority: prefs.priority } : {}) })
  const { data, error, reload } = usePoll(() => taskPage(call, query, limit), [call, query.toString(), limit])
  const { data: directories } = usePoll(() => call<Directory[]>('GET', 'task-directories'), [call], 30000)
  useEffect(() => {
    const sync = () => setPrefs(value => ({...value,selected:taskHash()}))
    window.addEventListener('hashchange',sync); window.addEventListener('popstate',sync)
    return () => {window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync)}
  }, [])
  const select = (id: string | undefined) => {
    setPrefs(value => ({...value,selected:id}))
    if (!id && history.state?.superagentTask && taskHash()) {history.back();return}
    const url = new URL(window.location.href);url.hash=id?`superagent/tasks/${id}`:''
    if (id) history.pushState({...history.state,superagentTask:true},'',url)
    else history.replaceState(history.state,'',url)
  }
  const changed = useCallback(async () => { setVersion(value => value + 1); await reload() }, [reload])
  const saved = useCallback((id: string) => { setCreating(undefined); setEditing(undefined); select(id); void changed() }, [changed])
  const create = (priority?: TaskPriority) => setCreating({ priority: priority ?? (prefs.priority || 'none') })
  const mutate = async (task: Pick<TaskView, 'id' | 'revision'>, action: string, priority?: TaskPriority) => {
    if (actionRunning.current) return
    actionRunning.current = true; setBusy(true); setFailure('')
    const key = `${task.id}:${action}:${priority ?? ''}`
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() }
    try {
      await call(priority ? 'PUT' : 'POST', `tasks/${task.id}/${action}`, { requestId: pending.current.id, revision: task.revision, ...(priority ? { priority } : {}) })
      pending.current = undefined; await changed()
    } catch (error) { setFailure(message(error)); await changed() }
    finally { actionRunning.current = false; setBusy(false) }
  }
  const move: Move = async (task, target, priority) => {
    if (task.stage === target) { if (priority) await mutate(task, 'properties', priority); return }
    if (priority && priority !== task.priority) { setFailure(t('task.movePriorityFirst')); return }
    const action = task.stage === 'draft' && target === 'queued' ? 'start' : task.stage === 'review' && target === 'done' ? 'confirm'
      : ['done', 'cancelled'].includes(task.stage) && target === 'draft' ? 'reopen' : !['done', 'cancelled'].includes(task.stage) && target === 'cancelled' ? 'cancel' : undefined
    if (!action) { setFailure(t('task.invalidMove')); return }
    if (action === 'cancel' && !window.confirm(t('task.cancelConfirm'))) return
    await mutate(task, action)
  }
  const visibleStages = selectedStage ? [selectedStage] : activeStages.filter(value => !prefs.hidden.includes(value))
  const filterCount = Number(!!prefs.directory) + Number(!!prefs.priority) + Number(!!stage)
  const lanePrefs = { ...prefs, q: debounced }
  return <PortalScope><div className={`st-ui st-page ${dark ? 'dark' : ''}`}><style>{STYLES}</style><style>{MULTICA_STYLES}</style><style>{FONT_STYLES}</style><style>{TASK_STYLES}</style>
    <div className={`st-overview ${prefs.selected ? 'st-overview-hidden' : ''}`} aria-hidden={!!prefs.selected} ref={element=>{if(prefs.selected)element?.setAttribute('inert','');else element?.removeAttribute('inert')}}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4"><h1 className="flex items-center gap-2 text-body font-medium"><Icon name="list" size={16}/>{t('task.heading')}</h1>
        <div className="flex items-center gap-2"><Button icon={<SlidersHorizontal className="size-3.5"/>} onClick={onSettings}>{t('task.settings')}</Button><Button variant="primary" icon={<Plus className="size-3.5"/>} onClick={()=>create()}>{t('task.create')}</Button></div>
      </header>
      <div className="st-toolbar flex min-h-12 shrink-0 items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-1" role="group" aria-label={t('task.quickViews')}>{(['all','waiting','review'] as const).map(value=><Button key={value} aria-pressed={prefs.scope===value && !stage} className={prefs.scope===value && !stage?'bg-muted/60':''} onClick={()=>{setStage(undefined);setLimit(50);setPrefs({...prefs,scope:value})}}>{t(value==='all'?'task.viewAll':value==='waiting'?'task.viewWaiting':'task.viewReview')}{value!=='all' && <span className="text-micro text-muted-foreground">{data?.counts[value]??'–'}</span>}</Button>)}</div>
        <div className="st-toolbar-right flex items-center gap-1">
          <span className="st-running flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption text-muted-foreground"><span className={`size-1.5 rounded-full ${data?.counts.working?'bg-success':'bg-faint-foreground'}`}/>{t('task.runningCount',{count:data?.counts.working??0})}</span>
          <Menu compact label={t('task.search')} icon={<Search className="size-3.5"/>}><Input aria-label={t('task.search')} placeholder={t('task.search')} value={prefs.q} onChange={event=>{setLimit(50);setPrefs({...prefs,q:event.target.value})}}/></Menu>
          <Menu label={`${t('task.filter')}${filterCount?` · ${filterCount}`:''}`} icon={<ListFilter className="size-3.5"/>}>
            <label className="st-menu-field">{t('task.directoryFilter')}<Choice label={t('task.directoryFilter')} value={prefs.directory} onChange={value=>{setLimit(50);setPrefs({...prefs,directory:value})}} options={[{value:'',label:t('task.allDirectories')},...(directories??[]).map(item=>({value:item.path,label:item.title}))]}/></label>
            <label className="st-menu-field">{t('task.priority')}<Choice label={t('task.priority')} value={prefs.priority} onChange={value=>{setLimit(50);setPrefs({...prefs,priority:value})}} options={[{value:'',label:t('task.allPriorities')},...TASK_PRIORITIES.map(value=>({value,label:t(`task.priority.${value}`)}))]}/></label>
            <label className="st-menu-field">{t('task.statusFilter')}<Choice label={t('task.statusFilter')} value={stage??''} onChange={value=>{setLimit(50);setStage(value||undefined)}} options={[{value:'',label:t('task.activeTasks')},...TASK_STAGES.map(value=>({value,label:titleOf(t,value)}))]}/></label>
            <Button onClick={()=>{setStage(undefined);setLimit(50);setPrefs({...prefs,q:'',directory:'',priority:'',scope:'all'})}}>{t('task.clearFilters')}</Button>
          </Menu>
          <Menu label={t('task.display')} icon={<SlidersHorizontal className="size-3.5"/>}>
            <label className="st-check"><input type="checkbox" checked={prefs.quadrants} onChange={event=>setPrefs({...prefs,quadrants:event.target.checked})}/>{t('task.quadrants')}</label>
            <label className="st-check"><input type="checkbox" checked={prefs.summaries} onChange={event=>setPrefs({...prefs,summaries:event.target.checked})}/>{t('task.showSummary')}</label>
            <h3 className="mt-2 text-caption text-muted-foreground">{t('task.columns')}</h3>{activeStages.map(value=><label className="st-check" key={value}><input type="checkbox" checked={!prefs.hidden.includes(value)} disabled={!prefs.hidden.includes(value)&&prefs.hidden.length===activeStages.length-1} onChange={event=>setPrefs({...prefs,hidden:event.target.checked?prefs.hidden.filter(item=>item!==value):[...prefs.hidden,value]})}/><StatusIcon stage={value}/>{titleOf(t,value)}</label>)}
          </Menu>
          <Choice label={t('task.display')} value={prefs.view} onChange={value=>setPrefs({...prefs,view:value})} options={[{value:'board',label:t('task.board'),icon:<Columns3 className="size-3.5"/>},{value:'list',label:t('task.list'),icon:<List className="size-3.5"/>}]}/>
        </div>
      </div>
      {prefs.q && <div className="flex items-center gap-2 px-4 pb-2 text-caption text-muted-foreground"><Search className="size-3.5"/>{prefs.q}<Button size="sm" aria-label={t('task.clearFilters')} onClick={()=>setPrefs({...prefs,q:''})}><Icon name="close" size={12}/></Button></div>}
      {failure && <p role="alert" className="st-error">{failure}</p>}{error && <p role="alert" className="st-error">{error.message}<Button onClick={()=>{void reload()}}>{t('task.refresh')}</Button></p>}
      {!data && !error && <p role="status" className="p-6 text-caption text-muted-foreground">{t('loading')}</p>}
      {data && (prefs.view==='board'?<TaskBoard t={t} busy={busy} onMove={move} onOrder={order=>setPrefs(value=>({...value,order:[...order,...(value.order??[]).filter(id=>!order.includes(id))]}))}>{visibleStages.map(value=><TaskLane key={value} stage={value} t={t} call={call} prefs={lanePrefs} version={version} busy={busy} canHide={!selectedStage&&visibleStages.length>1} onHide={()=>setPrefs({...prefs,hidden:[...prefs.hidden,value]})} onOpen={select} onCreate={create} onAction={(task,action)=>{void mutate(task,action)}}/>)}</TaskBoard>
        : <><TaskListView tasks={data.items} t={t} prefs={prefs} busy={busy} onOpen={select} onAction={(task,action)=>{void mutate(task,action)}}/>{data.nextOffset!==undefined && <Button onClick={()=>setLimit(limit+50)}>{t('loadMore')}</Button>}</>)}
    </div>
    {prefs.selected && <Detail key={prefs.selected} id={prefs.selected} version={version} t={t} call={call} onClose={()=>select(undefined)} onChanged={changed} onEdit={setEditing} openSession={openSession}/>}
    {(creating||editing) && <TaskForm key={editing?.id??'new'} initial={editing} defaults={{directory:prefs.directory,priority:creating?.priority??'none'}} t={t} call={call} directories={directories??[]} onClose={()=>{setCreating(undefined);setEditing(undefined)}} onSaved={saved}/>}
  </div></PortalScope>
}
