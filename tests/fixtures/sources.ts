/** 历史来源的纯数据策略夹具，用于核心准入、投递与持久化测试；没有网络收发。 */
import {z} from 'zod'
import type{SourceKind}from'../../src/sources/kind.ts'
import type{Trigger}from'../../src/core/index.ts'
const FeishuConfigSchema=z.object({cli:z.string().default('cli'),repository:z.string().default(''),chats:z.array(z.object({chatId:z.string(),name:z.string().optional(),listen:z.enum(['all','mentions'])})).default([]),directMessages:z.boolean().default(true),otherChats:z.enum(['none','mentions']).default('none'),observeIssues:z.boolean().default(false),observePulls:z.boolean().default(false),observeComments:z.boolean().default(false),observeCi:z.boolean().default(false)}).passthrough()
const GithubConfigSchema=z.object({cli:z.string().default('cli'),repository:z.string().default(''),chats:z.array(z.object({chatId:z.string(),name:z.string().optional(),listen:z.enum(['all','mentions'])})).default([]),directMessages:z.boolean().default(true),otherChats:z.enum(['none','mentions']).default('none'),observeIssues:z.boolean().default(false),observePulls:z.boolean().default(false),observeComments:z.boolean().default(false),observeCi:z.boolean().default(false)}).passthrough()
type Scope='issues'|'pulls'|'comments'|'ci'
const OBSERVED={issues:'observeIssues',pulls:'observePulls',comments:'observeComments',ci:'observeCi'} as const
const scopeOf=(meta:Record<string,unknown>):Scope|undefined=>meta.ci===true?(typeof meta.branch==='string'?'ci':undefined):meta.kind==='issue'?'issues':meta.kind==='pull'?'pulls':['conversation','inline','review'].includes(String(meta.kind))?'comments':undefined
const feishuTriggerId=(id:string)=>'feishu:'+id
export const feishuKind:SourceKind<z.infer<typeof FeishuConfigSchema>>={kind:'feishu',description:{zh:'测试来源',en:'Test source'},schema:FeishuConfigSchema,fields:[],title: { zh: '飞书', en: 'Feishu' },
health: ['feishu', 'history'],
scope({ meta }, config) {
    if (meta.direct === true) return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    const chat = config.chats.find(item => item.chatId === meta.chatId)
    if (chat) return { listened: true, observed: chat.listen === 'all', row: chat.chatId }
    return config.otherChats === 'mentions' ? { listened: true, observed: false, row: 'other' } : { listened: false, reason: 'chat_not_allowed' }
  },
find: query => ({ threads: [], terms: [...new Set(query.match(/om_[A-Za-z0-9_-]+/g) ?? [])] }),
repliesTo: trigger => typeof trigger.meta.parentId === 'string' ? feishuTriggerId(trigger.meta.parentId) : undefined,
policy: {
    unnamed: { person: { zh: '飞书用户', en: 'Feishu user' }, bot: { zh: '飞书机器人', en: 'Feishu bot' } },
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().regex(/^ou_[a-zA-Z0-9]+$/), name: z.string().trim().max(100).optional() }).strict())
        .refine(users => new Set(users.map(user => user.id)).size === users.length, 'Duplicate open_ids').default([]),
      syncChat: z.string().regex(/^(oc_[a-zA-Z0-9]+)?$/).default(''),
      bots: z.array(z.object({ id: z.string().regex(/^(cli|ou)_[a-zA-Z0-9]+$/), name: z.string().trim().max(100).optional() }).strict())
        .refine(bots => new Set(bots.map(bot => bot.id)).size === bots.length, 'Duplicate bot ids').optional(),
    }).strict(),
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的飞书用户', en: 'Feishu users who may originate work' },
        columns: [{ key: 'id', type: 'text', label: { zh: 'open_id', en: 'open_id' }, pattern: 'ou_[a-zA-Z0-9]+' }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
      { key: 'syncChat', type: 'text', pattern: '(oc_[a-zA-Z0-9]+)?', label: { zh: '同步来源群', en: 'Sync chat' }, choose: { zh: '不同步', en: 'Do not sync' },
        hint: { zh: '同步时，名单变成这个群里的人：新成员加入，离开的人移除，名字取群里的名字。启动时和点同步时进行。', en: 'Syncing makes the list the people in this chat: new members join, people who left are removed, and names follow the chat. It runs at startup and on Sync.' } },
      { key: 'bots', type: 'rows', label: { zh: '消息可以成为候选的机器人', en: 'Bots whose messages may become candidates' },
        hint: { zh: '名单里的机器人在接收的群里发的消息成为推断的候选，交给评估；它们不能发起明确的请求，也不能停止工单。其他机器人的消息不接收。', en: 'Messages of a bot on this list, in chats the Source receives, become inferred candidates for an assessment; they never make an explicit request or stop a ticket. Other bots\' messages are not admitted.' },
        columns: [{ key: 'id', type: 'text', label: { zh: 'App ID 或 open_id', en: 'App ID or open_id' }, pattern: '(cli|ou)_[a-zA-Z0-9]+' },
          { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
    ],
    explicit: { zh: '名单内的人 @ 机器人或私聊机器人，总是明确的请求，不需要配置。', en: 'Someone on the list who mentions the bot or messages it directly always makes an explicit request; that needs no setting.' },
    rows(stored) {
      const config = FeishuConfigSchema.parse(stored)
      const mentions = { zh: '仅 @', en: '@ only' }
      return [
        ...config.chats.map(chat => ({ id: chat.chatId, label: chat.name || chat.chatId, note: chat.listen === 'all' ? { zh: '全部消息', en: 'All' } : mentions,
          cells: { listedUnaddressed: chat.listen === 'all', unlistedAddressed: true, unlistedUnaddressed: chat.listen === 'all' } })),
        { id: 'other', label: { zh: '其他群', en: 'Other chats' }, note: config.otherChats === 'mentions' ? mentions : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.otherChats === 'mentions', unlistedUnaddressed: false } },
        { id: 'direct', label: { zh: '私聊', en: 'Direct messages' }, note: config.directMessages ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.directMessages, unlistedUnaddressed: false } },
      ]
    },

  }}
export const githubKind:SourceKind<z.infer<typeof GithubConfigSchema>>={kind:'github',description:{zh:'测试来源',en:'Test source'},schema:GithubConfigSchema,fields:[],title: { zh: 'GitHub', en: 'GitHub' },
scope: ({ meta }, config) => {
    const row = scopeOf(meta)
    return { listened: true, observed: row !== undefined && config[OBSERVED[row]], ...row ? { row } : {} }
  },
health: ['github'],
find: query => {
    const number = (/^#?(\d+)$/.exec(query.trim()) ?? /github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)/.exec(query))?.[1]
    return { threads: number ? [`${'github'}:${number}`] : [], terms: [] }
  },
policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9-]+$/) }).strict()).default([]),
      bots: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9-]+(\[bot\])?$/) }).strict()).optional() }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的 GitHub 账号', en: 'GitHub accounts that may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9\\-]+' }] },
    { key: 'bots', type: 'rows', label: { zh: '评论可以成为候选的机器人', en: 'Bots whose comments may become candidates' },
      hint: { zh: '名单里的机器人账号（例如 dependabot[bot]）的评论在来源收到时成为推断的候选，交给评估：评论 @ 了智能体，或者打开了“接收仓库里的评论”。它们不能发起明确的请求，也不能停止工单；其他机器人的评论不接收。', en: 'A comment of a bot account on this list, such as dependabot[bot], becomes an inferred candidate for an assessment when the Source receives it: when it mentions the agent, or with Receive comments in the repository on. Such a comment never makes an explicit request or stops a ticket; other bots\' comments are not admitted.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9\\-]+(\\[bot\\])?' }] }],
    explicit: { zh: '名单里的账号在 Issue 或评论里 @ 智能体的账号。', en: 'An account on the list mentions the agent\'s account in an Issue or a comment.' },
    rows(stored) {
      const config = GithubConfigSchema.partial().parse(stored)
      const note = (observed: boolean | undefined) => observed ? { zh: '全部', en: 'All' } : { zh: '仅 @', en: '@ only' }
      const row = (id: Scope, label: { zh: string; en: string }) => ({ id, label, note: note(config[OBSERVED[id]]),
        cells: { listedUnaddressed: !!config[OBSERVED[id]], unlistedAddressed: true, unlistedUnaddressed: !!config[OBSERVED[id]] } })
      return [row('issues', { zh: '新 Issue', en: 'New Issues' }), row('pulls', { zh: '新 PR', en: 'New pull requests' }),
        row('comments', { zh: '评论', en: 'Comments' }),
        // CI has no sender, so only the cell of a sender off the list who does not address the agent applies.
        { id: 'ci', label: { zh: '默认分支的 CI', en: 'Default branch CI' }, note: config.observeCi ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: !!config.observeCi } }]
    },
  }}
export function feishuTrigger(value: Record<string, unknown>, _bot: string, _app: string): Trigger {
  const id=String(value.message_id),chat=String(value.chat_id),root=String(value.root_id ?? id)
  const direct=value.chat_type==='p2p',mentioned=Array.isArray(value.mentions)&&value.mentions.some(m=>m.id===_bot||m.id===_app)
  return {id:`feishu:${id}`,source:'feishu',threads:[{source:'feishu',id:`${chat}:${root}`}],actor:{source:'feishu',id:String(value.sender_id)},human:value.sender_type==='user',...(direct?{addressed:'direct' as const}:mentioned?{addressed:'mention' as const}:{}),
    at:new Date(Number(value.create_time)).toISOString(),text:String(value.content),meta:{chatId:chat,messageId:id,direct,mentioned,...(value.root_id?{rootId:root}:{}),...(value.parent_id ? {parentId:String(value.parent_id)} : {})}}
}
