// Fast unit: catches provider substitution, thinking-only/truncated answers and accidental fallback. Expected 1s, max 15s.
import {test,expect} from "bun:test"
import {mkdtempSync,writeFileSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {subscriptionComplete,SUBSCRIPTION_MODELS} from "../src/lib/subscription"
import {demoEntries,demoTasks,memberTotals} from "../src/lib/demo-data"
const dir=mkdtempSync(join(tmpdir(),"vklad-adapter-")), key=join(dir,"test.key")
writeFileSync(key,"synthetic-test-credential",{mode:0o600})
test("subscription endpoints keep separate credentials and only accept exact complete text responses",async()=>{
 const previous=globalThis.fetch, oldG=process.env.VKLAD_GLM_KEY_FILE,oldM=process.env.VKLAD_MINIMAX_KEY_FILE
 process.env.VKLAD_GLM_KEY_FILE=key;process.env.VKLAD_MINIMAX_KEY_FILE=key
 const calls:any[]=[]
 let answer:any
 globalThis.fetch=(async(url:any,init:any)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(answer)}) as unknown as typeof fetch
 try {
  for(const model of SUBSCRIPTION_MODELS){answer={model,id:"synthetic-receipt",content:[{type:"thinking",thinking:"private reasoning"},{type:"text",text:"{}"}],stop_reason:"end_turn"};const r=await subscriptionComplete(model,[{role:"system",content:"policy"},{role:"user",content:"task"}]);expect(r.content).toBe("{}");expect(r.providerResponseId).toBe("synthetic-receipt");expect(calls.at(-1).body.system).toBe("policy");expect(calls.at(-1).body.messages).toHaveLength(1)}
  expect(calls[0].url).toBe("https://api.z.ai/api/anthropic/v1/messages");expect(calls[1].url).toBe("https://api.minimax.io/anthropic/v1/messages")
  answer={model:"other",content:[{type:"text",text:"{}"}]};await expect(subscriptionComplete(SUBSCRIPTION_MODELS[0],[])).rejects.toThrow("Оценка не засчитана")
  answer={model:SUBSCRIPTION_MODELS[0],content:[{type:"thinking",thinking:"only"}]};await expect(subscriptionComplete(SUBSCRIPTION_MODELS[0],[])).rejects.toThrow("пустой ответ")
  answer={model:SUBSCRIPTION_MODELS[0],content:[{type:"text",text:"{}"}],stop_reason:"max_tokens"};await expect(subscriptionComplete(SUBSCRIPTION_MODELS[0],[])).rejects.toThrow("не завершён")
  const count=calls.length;await expect(subscriptionComplete("gpt-6",[])).rejects.toThrow("недоступна");expect(calls.length).toBe(count)
  delete process.env.VKLAD_GLM_KEY_FILE;await expect(subscriptionComplete(SUBSCRIPTION_MODELS[0],[])).rejects.toThrow("не настроена");expect(calls.length).toBe(count)
 }finally{globalThis.fetch=previous;if(oldG===undefined)delete process.env.VKLAD_GLM_KEY_FILE;else process.env.VKLAD_GLM_KEY_FILE=oldG;if(oldM===undefined)delete process.env.VKLAD_MINIMAX_KEY_FILE;else process.env.VKLAD_MINIMAX_KEY_FILE=oldM;rmSync(dir,{recursive:true})}
})
test("demo starts populated, reset returns fresh independent examples, personal and team totals match",()=>{
 const entries=demoEntries();expect(memberTotals(entries,"you")).toEqual({work:900000,cash:300000});expect(entries.reduce((s,e)=>s+e.amountMinor,0)).toBe(2400000);expect(demoTasks()).toHaveLength(3)
 entries[0].amountMinor=1;expect(demoEntries()[0].amountMinor).toBe(900000)
 const tasks=demoTasks();tasks[0].done=false;expect(demoTasks()[0].done).toBe(true)
})
