import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/app/store.ts'
import { KV } from '../src/kv.ts'
const roots:string[]=[]
afterEach(()=>roots.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})))
it('upgrades schema 12 atomically, drops external work and delivery, and retains local task history and Session mapping',()=>{
 const root=mkdtempSync(join(tmpdir(),'superagent-migrate-'));roots.push(root);const path=join(root,'state.sqlite'),old=new Store(path)
 old.set(KV.store.schema,12);old.db.exec('CREATE TABLE outbox(id TEXT PRIMARY KEY,value TEXT NOT NULL)')
 const at='2026-11-01T00:00:00Z',trigger=(id:string,source:string)=>({id,source,threads:[{source,id}],actor:{source,id:'owner'},at,text:id,meta:{},})
 for(const source of ['local','feishu'])old.db.prepare('INSERT INTO trigger VALUES(?,?,?)').run(source,JSON.stringify(trigger(source,source)),at)
 for(const source of ['local','feishu'])old.db.prepare('INSERT INTO ticket VALUES(?,?)').run(source,JSON.stringify({id:source,origin:{triggerId:source,triggerIds:[source]},assignments:[],inputs:[],undelivered:[],execution:{name:source,directory:root,assignment:'',local:{strategy:'shared',projectDirectory:root,reason:'现有目录'}}}))
 old.db.prepare('INSERT INTO task VALUES(?,?)').run('task',JSON.stringify({id:'task',revision:2,title:'保留任务',description:'本地任务',directory:root,strategy:'auto',phase:'submitted',assets:['file'],tickets:['local'],activeTicket:'local',run:1,events:[{id:'created',kind:'created',text:'需求',assets:['file'],at},{id:'meta',kind:'properties',text:'旧属性',assets:[],at}]}))
 old.db.prepare('INSERT INTO effect(kind,key,value,seq,due,since) VALUES(?,?,?,?,?,?)').run('reply','reply','{}',1,0,at);old.db.exec("UPDATE task SET value=json_set(value,'$.priority','high','$.dueDate','2026-11-01'); UPDATE ticket SET value=json_set(value,'$.channels',json('[{}]'))");old.close()
 const store=new Store(path)
 try {expect(store.get(KV.store.schema)).toBe(13);expect(store.tickets.get('feishu')).toBeUndefined();expect(store.triggers.get('feishu')).toBeUndefined();expect(store.tickets.get('local')).toBeDefined()
  expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name='outbox'").get()).toBeUndefined();expect(store.db.prepare("SELECT key FROM effect WHERE kind='reply'").all()).toEqual([])
  const value=JSON.parse(String(store.db.prepare('SELECT value FROM task').get()!.value));expect(value).toMatchObject({sessionId:'worker-local',assets:['file'],preparation:{state:'ready'},events:[{id:'created',text:'需求'}]});expect(JSON.stringify(value)).not.toMatch(/priority|dueDate/)
 }finally{store.close()}
 const reopened=new Store(path);expect(reopened.get(KV.store.schema)).toBe(13);reopened.close()
})
